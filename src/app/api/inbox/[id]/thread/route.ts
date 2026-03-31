import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // Build a unified thread array with type tags
  const thread = [
    ...(outgoing ?? []).map((m) => ({
      type: "outgoing" as const,
      id: m.id,
      subject: m.subject,
      body_html: m.body_html,
      to_email: m.to_email,
      timestamp: m.sent_at,
      gmail_message_id: m.gmail_message_id,
    })),
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
    })),
  ].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  return NextResponse.json({ thread, inboxMessage });
}
