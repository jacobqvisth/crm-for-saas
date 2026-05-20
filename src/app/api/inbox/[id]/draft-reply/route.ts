import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { draftReplyInEnglish, htmlToText } from "@/lib/inbox/draft-reply";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";

/**
 * Generate (or fetch cached) an English-language draft reply for an inbox message.
 *
 * Body: { regenerate?: boolean }
 * Returns: { draft, cached, generatedAt }
 *
 * Cache lives on inbox_messages.draft_en. The client treats it like get-or-create:
 * first call generates and caches; subsequent calls return the cached version
 * unless { regenerate: true } is passed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let payload: { regenerate?: boolean } = {};
  try {
    payload = (await request.json()) as { regenerate?: boolean };
  } catch {
    // empty body is fine
  }

  // Load inbox message + the email_queue row it's a reply to (if any).
  const { data: inboxMessage, error: msgError } = await supabase
    .from("inbox_messages")
    .select(
      `id, workspace_id, gmail_thread_id, subject, body_html, body_text,
       detected_language, subject_translated_en, body_translated_en,
       draft_en, draft_generated_at, draft_model, contact_id, email_queue_id`,
    )
    .eq("id", id)
    .maybeSingle();

  if (msgError || !inboxMessage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Workspace gate.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", inboxMessage.workspace_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Return cache unless caller asked to regenerate.
  if (!payload.regenerate && inboxMessage.draft_en) {
    return NextResponse.json({
      draft: inboxMessage.draft_en,
      cached: true,
      generatedAt: inboxMessage.draft_generated_at,
    });
  }

  // Pull context for the model.

  // Contact (first/last names).
  let contactFirstName: string | null = null;
  let contactLastName: string | null = null;
  let companyName: string | null = null;
  if (inboxMessage.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("first_name, last_name, company_id")
      .eq("id", inboxMessage.contact_id)
      .maybeSingle();
    contactFirstName = contact?.first_name ?? null;
    contactLastName = contact?.last_name ?? null;
    if (contact?.company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("name")
        .eq("id", contact.company_id)
        .maybeSingle();
      companyName = company?.name ?? null;
    }
  }

  // Prior outbound — the email_queue row this is a reply to.
  let outboundPriorSubject: string | null = null;
  let outboundPriorBody: string | null = null;
  if (inboxMessage.email_queue_id) {
    const { data: outbound } = await supabase
      .from("email_queue")
      .select("subject, body_html")
      .eq("id", inboxMessage.email_queue_id)
      .maybeSingle();
    outboundPriorSubject = outbound?.subject ?? null;
    outboundPriorBody = htmlToText(outbound?.body_html ?? null);
  }

  // Recent thread history for additional context (last 5).
  const { data: priorOutboundRows } = await supabase
    .from("email_queue")
    .select("subject, body_html, sent_at")
    .eq("gmail_thread_id", inboxMessage.gmail_thread_id)
    .eq("status", "sent")
    .order("sent_at", { ascending: true });

  const { data: priorIncomingRows } = await supabase
    .from("inbox_messages")
    .select(
      "subject, subject_translated_en, body_html, body_translated_en, body_text, detected_language, received_at",
    )
    .eq("gmail_thread_id", inboxMessage.gmail_thread_id)
    .order("received_at", { ascending: true });

  type ThreadEntry = { from: "us" | "them"; body: string; subject: string | null; ts: number };
  const history: ThreadEntry[] = [];
  for (const o of priorOutboundRows ?? []) {
    history.push({
      from: "us",
      subject: o.subject ?? null,
      body: htmlToText(o.body_html ?? null),
      ts: o.sent_at ? new Date(o.sent_at).getTime() : 0,
    });
  }
  for (const r of priorIncomingRows ?? []) {
    const isTranslated = !!r.detected_language && r.detected_language !== "en";
    const subj = isTranslated ? r.subject_translated_en : r.subject;
    const bodyHtml = isTranslated ? r.body_translated_en : r.body_html;
    history.push({
      from: "them",
      subject: subj ?? null,
      body: bodyHtml ? htmlToText(bodyHtml) : (r.body_text ?? ""),
      ts: r.received_at ? new Date(r.received_at).getTime() : 0,
    });
  }
  history.sort((a, b) => a.ts - b.ts);

  // The latest inbound (English version preferred).
  const isInboundTranslated =
    !!inboxMessage.detected_language && inboxMessage.detected_language !== "en";
  const inboundBodyEn = isInboundTranslated
    ? htmlToText(inboxMessage.body_translated_en) ||
      (inboxMessage.body_text ?? "") // fallback if translation failed
    : htmlToText(inboxMessage.body_html ?? null) ||
      (inboxMessage.body_text ?? "");
  const inboundSubject = isInboundTranslated
    ? inboxMessage.subject_translated_en ?? inboxMessage.subject
    : inboxMessage.subject;

  // Drop the latest inbound from history (it's passed as ctx.inboundBodyEn) and
  // keep only the last 4 prior entries.
  const lastTs =
    history.length > 0 ? Math.max(...history.map((h) => h.ts)) : 0;
  const trimmedHistory = history
    .filter((h) => h.ts < lastTs)
    .slice(-4)
    .map((h) => ({ from: h.from, body: h.body, subject: h.subject }));

  // Pull the workspace's editable knowledge (settings page) — falls back to seed.
  const knowledge = await loadWrenchlaneKnowledge(supabase, inboxMessage.workspace_id);

  const result = await draftReplyInEnglish({
    contactFirstName,
    contactLastName,
    companyName,
    detectedLanguage: inboxMessage.detected_language ?? null,
    outboundPriorBody,
    outboundPriorSubject,
    inboundBodyEn,
    inboundSubject,
    threadHistory: trimmedHistory,
    knowledgeMd: knowledge.contentMd,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  const generatedAt = new Date().toISOString();
  await supabase
    .from("inbox_messages")
    .update({
      draft_en: result.draft,
      draft_generated_at: generatedAt,
      draft_model: result.model,
    })
    .eq("id", id);

  return NextResponse.json({
    draft: result.draft,
    cached: false,
    generatedAt,
  });
}
