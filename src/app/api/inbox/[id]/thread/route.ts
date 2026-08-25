import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Escape text before embedding it in the HTML we render for a message body. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render a plain-text reply body as the minimal HTML the thread view expects. */
function textToHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

type SentMeta = {
  reply_message_id?: string | null;
  gmail_message_id?: string | null;
  body_sent?: string | null;
  body_en?: string | null;
  target_language?: string | null;
  sent_language?: string | null;
  to_email?: string | null;
  subject?: string | null;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Get the inbox message
  const { data: inboxMessage } = await supabase
    .from("inbox_messages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!inboxMessage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get all outgoing emails in the same thread
  const { data: outgoing } = await supabase
    .from("email_queue")
    .select("id, subject, body_html, to_email, sent_at, sender_account_id, gmail_message_id, tracking_id")
    .eq("gmail_thread_id", inboxMessage.gmail_thread_id)
    .eq("status", "sent")
    .order("sent_at", { ascending: true });

  // Get all inbox messages in the same thread (may be multiple replies)
  const { data: allReplies } = await supabase
    .from("inbox_messages")
    .select("*")
    .eq("gmail_thread_id", inboxMessage.gmail_thread_id)
    .order("received_at", { ascending: true });

  // Replies sent from this inbox never create an email_queue row: /api/inbox/[id]/reply
  // sends through Gmail and records the send as an `email_sent` activity only. Building
  // the thread from email_queue alone therefore dropped every reply the rep wrote here,
  // so a thread showed the original sequence email and the prospect's answer but never
  // the answer we sent back. Pull those activities in and merge them as outgoing
  // messages, keyed on the Gmail message id so a send that DOES have a queue row
  // (sequence mail, one-off contact sends) is never rendered twice.
  const { data: sentActivities } = await supabase
    .from("activities")
    .select("id, created_at, metadata")
    .eq("workspace_id", inboxMessage.workspace_id)
    .eq("type", "email_sent")
    .eq("metadata->>gmail_thread_id", inboxMessage.gmail_thread_id)
    .order("created_at", { ascending: true });

  const activityRows = (sentActivities ?? []).map((a) => ({
    id: a.id,
    created_at: a.created_at,
    meta: (a.metadata ?? {}) as SentMeta,
  }));

  // Gmail message ids already covered by an email_queue row.
  const queuedMessageIds = new Set(
    (outgoing ?? [])
      .map((m) => m.gmail_message_id)
      .filter((v): v is string => Boolean(v))
  );

  // The English source of a translated send, keyed by Gmail message id, so an
  // outgoing message that shipped in the prospect's language can still be read
  // back in the language it was composed in.
  const englishByMessageId = new Map<string, { bodyEn: string; language: string | null }>();
  for (const row of activityRows) {
    const messageId = row.meta.reply_message_id ?? row.meta.gmail_message_id ?? null;
    const bodyEn = row.meta.body_en?.trim();
    const bodySent = row.meta.body_sent?.trim();
    if (!messageId || !bodyEn || !bodySent || bodyEn === bodySent) continue;
    englishByMessageId.set(messageId, {
      bodyEn,
      language: row.meta.target_language ?? row.meta.sent_language ?? null,
    });
  }

  const activityOutgoing = activityRows
    .filter((row) => {
      const messageId = row.meta.reply_message_id ?? row.meta.gmail_message_id ?? null;
      // Skip anything already present as a queue row, and anything with no body
      // to show (activity shapes that only logged a subject line).
      if (messageId && queuedMessageIds.has(messageId)) return false;
      return Boolean(row.meta.body_sent?.trim() || row.meta.body_en?.trim());
    })
    .map((row) => {
      const messageId = row.meta.reply_message_id ?? row.meta.gmail_message_id ?? null;
      const bodySent = row.meta.body_sent?.trim() || row.meta.body_en?.trim() || "";
      const bodyEn = row.meta.body_en?.trim() || null;
      const translated = Boolean(bodyEn && bodyEn !== bodySent);
      return {
        type: "outgoing" as const,
        id: row.id,
        subject: row.meta.subject ?? null,
        body_html: textToHtml(bodySent),
        // A reply from this inbox goes back to whoever wrote in.
        to_email: row.meta.to_email ?? inboxMessage.from_email,
        timestamp: row.created_at,
        gmail_message_id: messageId,
        body_en_html: translated ? textToHtml(bodyEn as string) : null,
        sent_language: translated
          ? row.meta.target_language ?? row.meta.sent_language ?? null
          : null,
      };
    });

  // Build a unified thread array with type tags
  const thread = [
    ...(outgoing ?? []).map((m) => {
      const english = m.gmail_message_id
        ? englishByMessageId.get(m.gmail_message_id)
        : undefined;
      return {
        type: "outgoing" as const,
        id: m.id,
        subject: m.subject,
        body_html: m.body_html,
        to_email: m.to_email,
        timestamp: m.sent_at,
        gmail_message_id: m.gmail_message_id,
        body_en_html: english ? textToHtml(english.bodyEn) : null,
        sent_language: english ? english.language : null,
      };
    }),
    ...activityOutgoing,
    ...(allReplies ?? []).map((m) => ({
      type: "incoming" as const,
      id: m.id,
      subject: m.subject,
      body_html: m.body_html,
      body_text: m.body_text,
      from_email: m.from_email,
      from_name: m.from_name,
      timestamp: m.received_at,
      gmail_message_id: m.gmail_message_id,
      detected_language: m.detected_language,
      subject_translated_en: m.subject_translated_en,
      body_translated_en: m.body_translated_en,
    })),
  ].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  return NextResponse.json({ thread, inboxMessage });
}
