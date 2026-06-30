import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/gmail/send";
import { translateOutboundReply } from "@/lib/inbox/translate-outbound";
import { insertActivity } from "@/lib/activities/insert";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const requestBody = (await request.json()) as { body?: string };
  const replyBody = requestBody.body;

  if (!replyBody?.trim()) {
    return NextResponse.json({ error: "Reply body is required" }, { status: 400 });
  }

  // Get the inbox message
  const { data: inboxMessage } = await supabase
    .from("inbox_messages")
    .select("*, email_queue(sender_account_id, to_email, subject, workspace_id)")
    .eq("id", id)
    .maybeSingle();

  if (!inboxMessage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const emailQueue = inboxMessage.email_queue as {
    sender_account_id: string;
    to_email: string;
    subject: string;
    workspace_id: string;
  } | null;

  if (!emailQueue) {
    return NextResponse.json(
      { error: "Cannot reply: original outgoing email not found" },
      { status: 400 }
    );
  }

  // Translate the (English) reply to the recipient's language if needed.
  // The composer holds English (Jacob reads and approves in English). The
  // wire body that actually ships is the translated version. Both are stored
  // in activities.metadata for audit.
  const detectedLanguage = inboxMessage.detected_language ?? "en";
  const translation = await translateOutboundReply({
    bodyEn: replyBody,
    targetLanguage: detectedLanguage,
  });

  if (!translation.ok) {
    return NextResponse.json(
      {
        error: `Translation to ${detectedLanguage} failed: ${translation.reason}. Reply not sent.`,
      },
      { status: 502 },
    );
  }

  const sentBody = translation.translated;
  const htmlBody = `<p>${sentBody.replace(/\n/g, "<br>")}</p>`;
  const replySubject = inboxMessage.subject?.startsWith("Re:")
    ? inboxMessage.subject
    : `Re: ${inboxMessage.subject || ""}`;

  const result = await sendEmail({
    accountId: emailQueue.sender_account_id,
    to: inboxMessage.from_email,
    subject: replySubject,
    htmlBody,
    replyToMessageId: inboxMessage.gmail_message_id,
    // Manual replies are human-paced — exempt from the per-account
    // min_send_interval_seconds throttle that governs sequence sends.
    bypassSendInterval: true,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send reply" }, { status: 500 });
  }

  const { data: senderAccount } = await supabase
    .from("gmail_accounts")
    .select("email_address, display_name")
    .eq("id", emailQueue.sender_account_id)
    .maybeSingle();

  // Create activity record — keep BOTH the approved English version and the
  // translated wire body so the audit trail is clear if something looks off
  // later. (Jacob's preferences in memory: store both versions.)
  await insertActivity(supabase, {
    workspace_id: inboxMessage.workspace_id,
    type: "email_sent",
    subject: `Reply sent: ${replySubject}`,
    contact_id: inboxMessage.contact_id,
    metadata: {
      inbox_message_id: id,
      gmail_thread_id: inboxMessage.gmail_thread_id,
      reply_message_id: result.messageId,
      body_en: replyBody,
      body_sent: sentBody,
      target_language: translation.targetLanguage,
      translation_model: translation.model,
      sender_account_id: emailQueue.sender_account_id,
      sender_email: senderAccount?.email_address ?? null,
      sender_name: senderAccount?.display_name ?? null,
    },
  });

  // Mark the whole thread answered and clear any in-progress draft, so it moves
  // out of "Needs reply"/"Started replying" and into "Recently answered". We
  // stamp every still-unanswered message in the thread (a thread can hold
  // several inbound messages) — a later inbound reply lands a fresh row with
  // replied_at NULL and resurfaces in "Needs reply" on its own.
  await supabase
    .from("inbox_messages")
    .update({
      replied_at: new Date().toISOString(),
      reply_draft: null,
      reply_draft_updated_at: null,
    })
    .eq("workspace_id", inboxMessage.workspace_id)
    .eq("gmail_thread_id", inboxMessage.gmail_thread_id)
    .is("replied_at", null);

  return NextResponse.json({
    success: true,
    target_language: translation.targetLanguage,
    body_sent: sentBody,
  });
}
