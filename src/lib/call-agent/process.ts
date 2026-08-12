import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@/lib/database.types";
import { insertActivity } from "@/lib/activities/insert";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";
import { analyzeCall } from "@/lib/calls/ai-summary";
import { CALL_OUTCOME_LABEL, nextLeadStatus } from "@/lib/calls/decision";
import type { ProviderConversation } from "./elevenlabs";

type Client = SupabaseClient<Database>;

/**
 * Ingest a finished provider conversation into a call_sessions row: store the
 * transcript, run the CRM's own Claude analysis (the authoritative record —
 * the realtime model's own summary is advisory), auto-log the activity, and
 * honor in-call opt-outs.
 *
 * Mirrors processCallSession() but starts from a ready transcript instead of
 * a recording. Idempotent the same way (re-run updates in place).
 */
export async function ingestAgentConversation(
  supabase: Client,
  sessionId: string,
  conversation: ProviderConversation,
): Promise<{ ok: boolean; status: string; reason?: string }> {
  const { data: session } = await supabase
    .from("call_sessions")
    .select("id, workspace_id, contact_id, company_id, activity_id, agent_job_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return { ok: false, status: "error", reason: "session not found" };

  const turns = conversation.transcript ?? [];
  if (turns.length === 0) {
    await supabase
      .from("call_sessions")
      .update({
        status: "no_recording",
        provider_conversation_id: conversation.conversation_id,
        ended_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    return { ok: false, status: "no_recording", reason: "empty transcript (likely no answer)" };
  }

  await supabase.from("call_sessions").update({ status: "processing" }).eq("id", sessionId);

  // Same utterance shape the Deepgram path stores, so CallDetailDrawer renders
  // agent calls with zero UI changes.
  const utterances = turns.map((t) => ({
    speaker: t.role === "agent" ? "agent" : "contact",
    text: t.message ?? "",
    start: t.time_in_call_secs ?? 0,
  }));
  const transcriptText = utterances
    .filter((u) => u.text)
    .map((u) => `${u.speaker === "agent" ? "Agent" : "Contact"}: ${u.text}`)
    .join("\n");

  const { data: contact } = session.contact_id
    ? await supabase
        .from("contacts")
        .select("id, first_name, last_name, lead_status, company_id, language, country_code, email")
        .eq("id", session.contact_id)
        .maybeSingle()
    : { data: null };
  const { data: company } = session.company_id
    ? await supabase
        .from("companies")
        .select("name, country_code")
        .eq("id", session.company_id)
        .maybeSingle()
    : { data: null };
  const contactName =
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || null;

  const cc = (contact?.country_code ?? company?.country_code ?? "").toUpperCase();
  const lang = contact?.language?.slice(0, 2).toLowerCase();
  const languageHint: "sv" | "other" | "unknown" =
    lang === "sv" || (!lang && cc === "SE") ? "sv" : lang || cc ? "other" : "unknown";

  const { contentMd } = await loadWrenchlaneKnowledge(supabase, session.workspace_id);
  const analyzed = await analyzeCall({
    transcript: transcriptText,
    contactName,
    companyName: company?.name ?? null,
    knowledgeMd: contentMd,
    today: new Date().toISOString().slice(0, 10),
    languageHint,
  });

  const durationSecs = conversation.metadata?.call_duration_secs ?? null;

  if (!analyzed.ok) {
    await supabase
      .from("call_sessions")
      .update({
        status: "failed",
        error: analyzed.reason,
        transcript: utterances as unknown as Json,
        provider_conversation_id: conversation.conversation_id,
        ...(durationSecs != null ? { duration_seconds: durationSecs } : {}),
      })
      .eq("id", sessionId);
    return { ok: false, status: "failed", reason: analyzed.reason };
  }

  const a = analyzed.analysis;

  // Activity on the timeline, badged as an autonomous agent call.
  let activityId = session.activity_id ?? undefined;
  const metadata: Record<string, Json> = {
    outcome: a.suggested_outcome,
    connected: true,
    direction: "outbound",
    ai_generated: true,
    agent: true,
    call_session_id: sessionId,
    sentiment: a.sentiment,
    provider_conversation_id: conversation.conversation_id,
  };
  if (durationSecs != null) metadata.duration_seconds = durationSecs;

  const subject = `AI call: ${CALL_OUTCOME_LABEL[a.suggested_outcome]} — ${contactName ?? "contact"}`;

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
          user_id: null,
          metadata,
        },
        { context: "ingestAgentConversation" },
      );
      activityId = inserted.id;
    } catch (err) {
      console.error("ingestAgentConversation: activity insert failed", err);
    }
  }

  if (contact) {
    const update: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
    const ls = nextLeadStatus(contact.lead_status, a.suggested_outcome, true);
    if (ls) update.lead_status = ls;
    await supabase.from("contacts").update(update).eq("id", contact.id);
  }

  if (a.feedback_items.length > 0 && activityId) {
    const rows: TablesInsert<"call_feedback">[] = a.feedback_items.map((f) => ({
      workspace_id: session.workspace_id,
      activity_id: activityId!,
      contact_id: session.contact_id,
      company_id: session.company_id,
      user_id: null,
      category: f.category,
      severity: f.severity,
      title: f.title,
      body: f.body,
    }));
    await supabase.from("call_feedback").insert(rows);
  }

  // In-call opt-out: the agent is instructed to confirm "never call again".
  // Detect it from the authoritative analysis and honor it immediately.
  const saidNeverCall =
    a.suggested_outcome === "not_interested" &&
    /never call|inte ring|ring inte|do not call|don't call/i.test(transcriptText);
  if (saidNeverCall && contact?.email) {
    const { error: exclErr } = await supabase.from("call_exclusions").upsert(
      {
        workspace_id: session.workspace_id,
        kind: "email",
        value: contact.email.toLowerCase(),
        label: `${contactName ?? contact.email} (asked on AI call)`,
      },
      { onConflict: "workspace_id,kind,value" },
    );
    if (exclErr) console.error("ingestAgentConversation: never-call insert failed", exclErr);
  }

  // Callback escalation: agent promised a human follow-up.
  const wantsHuman = /colleague will call|kollega (ringer|återkommer)|call (you|me) back/i.test(
    transcriptText,
  );
  if (wantsHuman && session.contact_id) {
    const { data: settings } = await supabase
      .from("call_agent_settings")
      .select("callback_owner_user_id")
      .eq("workspace_id", session.workspace_id)
      .maybeSingle();
    const taskRow: TablesInsert<"tasks"> = {
      workspace_id: session.workspace_id,
      type: "call",
      title: `Callback: ${contactName ?? "contact"} (asked for a human on AI call)`,
      contact_id: session.contact_id,
      company_id: session.company_id,
      due_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      priority: "high",
      created_by: settings?.callback_owner_user_id ?? null,
    };
    const { error: taskErr } = await supabase.from("tasks").insert(taskRow);
    if (taskErr) console.error("ingestAgentConversation: callback task insert failed", taskErr);
  }

  await supabase
    .from("call_sessions")
    .update({
      status: "processed",
      transcript: utterances as unknown as Json,
      summary: a.summary,
      ai_json: {
        ...(a as unknown as Record<string, Json>),
        provider_analysis: (conversation.analysis ?? null) as unknown as Json,
      } as unknown as Json,
      ai_model: analyzed.model,
      ai_processed_at: new Date().toISOString(),
      activity_id: activityId ?? null,
      provider_conversation_id: conversation.conversation_id,
      ended_at: new Date().toISOString(),
      ...(durationSecs != null ? { duration_seconds: durationSecs } : {}),
    })
    .eq("id", sessionId);

  if (session.agent_job_id) {
    await supabase
      .from("call_agent_jobs")
      .update({
        status: "done",
        finished_at: new Date().toISOString(),
        provider_conversation_id: conversation.conversation_id,
      })
      .eq("id", session.agent_job_id);
  }

  return { ok: true, status: "processed" };
}
