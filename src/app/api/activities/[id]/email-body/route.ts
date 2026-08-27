import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getGmailClient } from "@/lib/gmail/client";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";
import { extractTextBody, extractHtmlBody } from "@/lib/gmail/messages";

/**
 * Returns the full email body for an activity, resolved from the underlying
 * message store. Activity rows only carry a short summary in `body` (e.g.
 * "Email from foo@bar.com"); the real message text lives in `inbox_messages`
 * (inbound) or `email_queue` (outbound). We resolve it here via the ids stashed
 * in the activity's metadata, so this works retroactively for every logged email.
 *
 * Mail a rep wrote by hand in the Gmail web app has neither: `mailbox-sync`
 * logs it as an activity but there is no queue row (we never composed it) and
 * no inbox row (it is outbound). Those fell through to "Full message text not
 * available". Since we already hold the mailbox's OAuth token, the last resort
 * is to go read it from Gmail — which also revives every such email already
 * logged, with no backfill.
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
    .select("id, type, subject, metadata, workspace_id")
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

  // 3) Nothing stored locally. If the activity came from mailbox-sync we know
  //    which mailbox holds the message, so fetch it straight from Gmail.
  const gmailAccountId =
    typeof meta.gmail_account_id === "string" ? meta.gmail_account_id : null;

  if (gmailMessageId && gmailAccountId) {
    const body = await fetchBodyFromGmail(
      gmailAccountId,
      gmailMessageId,
      activity.workspace_id,
    );
    if (body) {
      return NextResponse.json({
        source: "gmail",
        subject: activity.subject,
        body_html: body.html,
        body_text: body.text,
        detected_language: null,
        subject_translated_en: null,
        body_translated_en: null,
      });
    }
  }

  // Nothing stored (older activity, non-email, or body never captured).
  return NextResponse.json({ source: null, body_html: null, body_text: null });
}

/**
 * Read one message out of a connected mailbox. Uses the service client because
 * OAuth tokens are service-role-only, so the workspace check is done by hand:
 * the mailbox must belong to the same workspace as the activity the caller was
 * already allowed to read. Returns null on any failure — a disconnected
 * mailbox or a deleted message must degrade to "not available", never a 500.
 */
async function fetchBodyFromGmail(
  gmailAccountId: string,
  gmailMessageId: string,
  workspaceId: string,
): Promise<{ html: string | null; text: string | null } | null> {
  try {
    const admin = createServiceClient();
    const { data: account } = await admin
      .from("gmail_accounts")
      .select("id, workspace_id, status")
      .eq("id", gmailAccountId)
      .maybeSingle();

    if (!account || account.workspace_id !== workspaceId) return null;
    if (account.status === "disconnected") return null;

    const tokenResult = await getValidAccessToken(account.id);
    if ("error" in tokenResult) return null;

    const gmail = getGmailClient(tokenResult.accessToken);
    const { data: message } = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "full",
    });
    if (!message?.payload) return null;

    const html = extractHtmlBody(message.payload) || null;
    const text = extractTextBody(message.payload) || null;
    if (!html && !text) return null;
    return { html, text };
  } catch (err) {
    console.error("email-body: Gmail fetch failed", err);
    return null;
  }
}
