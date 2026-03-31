import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/gmail/send";

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
  const body = await request.json();
  const { body: replyBody } = body as { body: string };

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

  const htmlBody = `<p>${replyBody.replace(/\n/g, "<br>")}</p>`;
  const replySubject = inboxMessage.subject?.startsWith("Re:")
    ? inboxMessage.subject
    : `Re: ${inboxMessage.subject || ""}`;

  const result = await sendEmail({
    accountId: emailQueue.sender_account_id,
    to: inboxMessage.from_email,
    subject: replySubject,
    htmlBody,
    replyToMessageId: inboxMessage.gmail_message_id,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send reply" }, { status: 500 });
  }

  // Create activity record
  await supabase.from("activities").insert({
    workspace_id: inboxMessage.workspace_id,
    type: "email_sent",
    subject: `Reply sent: ${replySubject}`,
    contact_id: inboxMessage.contact_id,
    metadata: {
      inbox_message_id: id,
      gmail_thread_id: inboxMessage.gmail_thread_id,
      reply_message_id: result.messageId,
    },
  });

  return NextResponse.json({ success: true });
}
