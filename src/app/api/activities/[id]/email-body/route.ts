import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns the full email body for an activity, resolved from the underlying
 * message store. Activity rows only carry a short summary in `body` (e.g.
 * "Email from foo@bar.com"); the real message text lives in `inbox_messages`
 * (inbound) or `email_queue` (outbound). We resolve it here via the ids stashed
 * in the activity's metadata, so this works retroactively for every logged email.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // RLS scopes this to the caller's workspace(s).
  const { data: activity } = await supabase
    .from("activities")
    .select("id, type, subject, metadata")
    .eq("id", id)
    .maybeSingle();

  if (!activity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const gmailMessageId =
    typeof meta.gmail_message_id === "string" ? meta.gmail_message_id : null;
  const emailQueueId =
    typeof meta.email_queue_id === "string" ? meta.email_queue_id : null;

  // 1) Inbound (and mailbox-synced outbound) messages live in inbox_messages,
  //    keyed by the Gmail message id.
  if (gmailMessageId) {
    const { data: inbox } = await supabase
      .from("inbox_messages")
      .select(
        "subject, body_html, body_text, detected_language, subject_translated_en, body_translated_en",
      )
      .eq("gmail_message_id", gmailMessageId)
      .maybeSingle();

    if (inbox && (inbox.body_html || inbox.body_text)) {
      return NextResponse.json({
        source: "inbox",
        subject: inbox.subject ?? activity.subject,
        body_html: inbox.body_html,
        body_text: inbox.body_text,
        detected_language: inbox.detected_language,
        subject_translated_en: inbox.subject_translated_en,
        body_translated_en: inbox.body_translated_en,
      });
    }
  }

  // 2) Outbound sequence / one-off emails live in email_queue.
  if (emailQueueId || gmailMessageId) {
    let query = supabase
      .from("email_queue")
      .select("subject, body_html, body_text");
    query = emailQueueId
      ? query.eq("id", emailQueueId)
      : query.eq("gmail_message_id", gmailMessageId!);

    const { data: queued } = await query.maybeSingle();

    if (queued && (queued.body_html || queued.body_text)) {
      return NextResponse.json({
        source: "queue",
        subject: queued.subject ?? activity.subject,
        body_html: queued.body_html,
        body_text: queued.body_text,
        detected_language: null,
        subject_translated_en: null,
        body_translated_en: null,
      });
    }
  }

  // Nothing stored (older activity, non-email, or body never captured).
  return NextResponse.json({ source: null, body_html: null, body_text: null });
}
