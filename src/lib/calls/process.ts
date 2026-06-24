import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@/lib/database.types";
import { insertActivity } from "@/lib/activities/insert";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";
import { fetchRecordingAudio } from "./elks";
import { transcribeAudio, formatTranscript } from "./deepgram";
import { analyzeCall } from "./ai-summary";
import { CALL_OUTCOME_LABEL, nextLeadStatus } from "./decision";

type Client = SupabaseClient<Database>;

export interface ProcessResult {
  ok: boolean;
  status: string;
  reason?: string;
  activityId?: string;
}

/**
 * Run the post-call AI pipeline for a call_sessions row: fetch the recording,
 * transcribe (Deepgram), analyze (Claude), persist the artifacts, and AUTO-LOG
 * a lightweight call activity to the contact timeline.
 *
 * Intentionally NON-destructive on auto-run: it advances lead_status (never
 * downgrades) and stores product feedback, but does NOT set do-not-contact,
 * enroll into sequences, send the follow-up email, or create callback tasks.
 * Those are surfaced as suggestions in the call review card for the agent to
 * approve — so a mis-classified outcome can never silently DNC a customer.
 *
 * Idempotent: re-running on an already-processed session re-analyzes and
 * updates in place (it reuses the existing activity_id rather than duplicating).
 */
export async function processCallSession(
  supabase: Client,
  sessionId: string,
): Promise<ProcessResult> {
  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select(
      "id, workspace_id, contact_id, company_id, user_id, recording_url, duration_seconds, activity_id, status",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return { ok: false, status: "error", reason: sErr.message };
  if (!session) return { ok: false, status: "error", reason: "session not found" };

  if (!session.recording_url) {
    await supabase.from("call_sessions").update({ status: "no_recording" }).eq("id", sessionId);
    return { ok: false, status: "no_recording", reason: "no recording url" };
  }

  await supabase.from("call_sessions").update({ status: "processing" }).eq("id", sessionId);

  // Contact + company context for the summary.
  const { data: contact } = session.contact_id
    ? await supabase
        .from("contacts")
        .select("id, first_name, last_name, lead_status, status, company_id, language")
        .eq("id", session.contact_id)
        .maybeSingle()
    : { data: null };
  const { data: company } = session.company_id
    ? await supabase.from("companies").select("name").eq("id", session.company_id).maybeSingle()
    : { data: null };

  const contactName =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || null;

  // 1) Transcribe.
  let transcriptUtterances;
  try {
    const { buffer, contentType } = await fetchRecordingAudio(session.recording_url);
    transcriptUtterances = await transcribeAudio(buffer, contentType, {
      language: contact?.language ?? undefined,
      timeoutMs: (session.duration_seconds ?? 0) > 120 ? 180_000 : 120_000,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "transcription failed";
    await supabase.from("call_sessions").update({ status: "failed", error: reason }).eq("id", sessionId);
    return { ok: false, status: "failed", reason };
  }
  const transcriptText = formatTranscript(transcriptUtterances);

  // 2) Analyze.
  const { contentMd } = await loadWrenchlaneKnowledge(supabase, session.workspace_id);
  const today = new Date().toISOString().slice(0, 10);
  const analyzed = await analyzeCall({
    transcript: transcriptText,
    contactName,
    companyName: company?.name ?? null,
    knowledgeMd: contentMd,
    today,
  });

  if (!analyzed.ok) {
    // Keep the transcript even if analysis failed.
    await supabase
      .from("call_sessions")
      .update({
        status: "failed",
        error: analyzed.reason,
        transcript: transcriptUtterances as unknown as Json,
      })
      .eq("id", sessionId);
    return { ok: false, status: "failed", reason: analyzed.reason };
  }

  const a = analyzed.analysis;

  // 3) Auto-log the call activity (or update the existing one on re-run).
  let activityId = session.activity_id ?? undefined;
  const metadata: Record<string, Json> = {
    outcome: a.suggested_outcome,
    connected: true,
    direction: "outbound",
    ai_generated: true,
    call_session_id: sessionId,
    sentiment: a.sentiment,
    recording_url: session.recording_url,
  };
  if (typeof session.duration_seconds === "number") {
    metadata.duration_seconds = session.duration_seconds;
  }

  const subject = `Call: ${CALL_OUTCOME_LABEL[a.suggested_outcome]} — ${contactName ?? "contact"}`;

  if (activityId) {
    await supabase
      .from("activities")
      .update({ outcome: a.suggested_outcome, subject, body: a.summary, metadata })
      .eq("id", activityId);
  } else {
    try {
      const inserted = await insertActivity(
        supabase,
        {
          workspace_id: session.workspace_id,
          type: "call",
          outcome: a.suggested_outcome,
          subject,
          body: a.summary,
          contact_id: session.contact_id,
          company_id: session.company_id,
          user_id: session.user_id,
          metadata,
        },
        { context: "processCallSession" },
      );
      activityId = inserted.id;
    } catch (err) {
      // Non-fatal: we still keep the session artifacts.
      console.error("processCallSession: activity insert failed", err);
    }
  }

  // 4) Recency + lead status (advance only, never downgrade).
  if (contact) {
    const update: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
    const ls = nextLeadStatus(contact.lead_status, a.suggested_outcome, true);
    if (ls) update.lead_status = ls;
    await supabase.from("contacts").update(update).eq("id", contact.id);
  }

  // 5) Product feedback → triage board (non-destructive, high value).
  if (a.feedback_items.length > 0 && activityId) {
    const rows: TablesInsert<"call_feedback">[] = a.feedback_items.map((f) => ({
      workspace_id: session.workspace_id,
      activity_id: activityId!,
      contact_id: session.contact_id,
      company_id: session.company_id,
      user_id: session.user_id,
      category: f.category,
      severity: f.severity,
      title: f.title,
      body: f.body,
    }));
    await supabase.from("call_feedback").insert(rows);
  }

  // 6) Persist the full analysis on the session.
  await supabase
    .from("call_sessions")
    .update({
      status: "processed",
      transcript: transcriptUtterances as unknown as Json,
      summary: a.summary,
      ai_json: a as unknown as Json,
      ai_model: analyzed.model,
      ai_processed_at: new Date().toISOString(),
      activity_id: activityId ?? null,
    })
    .eq("id", sessionId);

  return { ok: true, status: "processed", activityId };
}
