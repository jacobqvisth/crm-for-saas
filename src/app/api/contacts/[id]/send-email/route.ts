import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/gmail/send";
import { getNextSender } from "@/lib/gmail/sender-rotation";
import { resolveVariables } from "@/lib/sequences/variables";
import { insertActivity } from "@/lib/activities/insert";
import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

type SendOneOffRequest = {
  subject?: string;
  /** HTML body, may contain {{variable}} / TipTap variable spans */
  bodyHtml?: string;
  /** Optional explicit sender; falls back to round-robin getNextSender */
  senderAccountId?: string;
};

/**
 * Send a single one-off email to a contact from the contact profile.
 *
 * Distinct from sequence sends: there is no enrollment and no step. We still
 * create an `email_queue` row (enrollment_id / step_id null) so that:
 *   - open/click tracking resolves (tracking routes look up email_queue by tracking_id)
 *   - the check-replies cron can detect replies (it only scans rows with gmail_thread_id set)
 *   - the message shows up consistently alongside sequence mail
 *
 * Human-paced like an inbox reply (bypassSendInterval), but still subject to
 * the per-account daily cap. Merge variables ({{first_name}} etc.) are
 * resolved server-side against the live contact + company.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: contactId } = await params;
  const body = (await request.json()) as SendOneOffRequest;

  const subject = body.subject?.trim();
  const bodyHtml = body.bodyHtml?.trim();
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (!bodyHtml) {
    return NextResponse.json({ error: "Email body is required" }, { status: 400 });
  }

  // Load the contact (RLS scopes this to the user's workspace).
  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const typedContact = contact as Contact;
  const workspaceId = typedContact.workspace_id;
  const toEmail = typedContact.email;

  if (!toEmail) {
    return NextResponse.json(
      { error: "This contact has no email address" },
      { status: 400 }
    );
  }

  // Don't send to bounced / unsubscribed contacts.
  if (typedContact.status === "bounced" || typedContact.status === "unsubscribed") {
    return NextResponse.json(
      { error: `Cannot send: contact is marked ${typedContact.status}` },
      { status: 409 }
    );
  }

  // Respect the suppression list (unsubscribe + bounce + DNC), by email or domain.
  const emailDomain = toEmail.split("@")[1]?.toLowerCase();
  const { data: suppression } = await supabase
    .from("suppressions")
    .select("id, reason")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .or(
      emailDomain
        ? `email.eq.${toEmail},domain.eq.${emailDomain}`
        : `email.eq.${toEmail}`
    )
    .limit(1)
    .maybeSingle();

  if (suppression) {
    return NextResponse.json(
      { error: `Cannot send: address is suppressed (${suppression.reason ?? "suppressed"})` },
      { status: 409 }
    );
  }

  // Load the company for {{company_name}} resolution.
  let company: Company | null = null;
  if (typedContact.company_id) {
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("id", typedContact.company_id)
      .maybeSingle();
    company = (data as Company) ?? null;
  }

  // Pick the sender: caller's explicit choice (validated to an active account
  // in the workspace) or, failing that, the logged-in user's OWN account.
  // This is an interactive send (one-off "Email" button / post-call follow-up)
  // so it should go out from the rep who is acting — e.g. if Jacob just called
  // the contact, the follow-up is "from Jacob", not from whichever teammate's
  // account happens to have the lowest daily send count. Only falls back to the
  // round-robin least-used account if the acting user has no eligible account.
  let senderId = body.senderAccountId ?? null;
  if (senderId) {
    const { data: chosen } = await supabase
      .from("gmail_accounts")
      .select("id, status")
      .eq("id", senderId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!chosen || chosen.status !== "active") {
      senderId = null; // fall through to rotation
    }
  }
  if (!senderId) {
    const next = await getNextSender(workspaceId, undefined, user.id);
    senderId = next?.id ?? null;
  }
  if (!senderId) {
    return NextResponse.json(
      { error: "No active sending account with remaining daily capacity" },
      { status: 409 }
    );
  }

  // Resolve merge variables against the live contact + company. The tracking
  // pixel/link wrapping is applied inside sendEmail using this tracking_id.
  const trackingId = randomUUID();
  const resolvedSubject = resolveVariables(subject, typedContact, company, trackingId);
  const resolvedBody = resolveVariables(bodyHtml, typedContact, company, trackingId);

  // Create the queue row up front so tracking has something to resolve against.
  const { data: queueRow, error: queueError } = await supabase
    .from("email_queue")
    .insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      sender_account_id: senderId,
      to_email: toEmail,
      subject: resolvedSubject,
      body_html: resolvedBody,
      status: "sending",
      scheduled_for: new Date().toISOString(),
      tracking_id: trackingId,
    })
    .select("id")
    .single();

  if (queueError || !queueRow) {
    return NextResponse.json(
      { error: queueError?.message || "Failed to queue email" },
      { status: 500 }
    );
  }

  // Send. Human-paced: skip the per-account min-interval throttle (still
  // subject to the daily cap inside sendEmail).
  const result = await sendEmail({
    accountId: senderId,
    to: toEmail,
    subject: resolvedSubject,
    htmlBody: resolvedBody,
    trackingId,
    bypassSendInterval: true,
  });

  if (!result.success) {
    await supabase
      .from("email_queue")
      .update({ status: "failed", error_message: result.error ?? "Send failed" })
      .eq("id", queueRow.id);
    return NextResponse.json(
      { error: result.error || "Failed to send email" },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();
  await supabase
    .from("email_queue")
    .update({
      status: "sent",
      sent_at: sentAt,
      gmail_message_id: result.messageId ?? null,
      gmail_thread_id: result.threadId ?? null,
    })
    .eq("id", queueRow.id);

  // Stamp last_contacted_at so list/segment filters stay accurate.
  await supabase
    .from("contacts")
    .update({ last_contacted_at: sentAt })
    .eq("id", contactId);

  const { data: senderAccount } = await supabase
    .from("gmail_accounts")
    .select("email_address, display_name")
    .eq("id", senderId)
    .maybeSingle();

  await insertActivity(supabase, {
    workspace_id: workspaceId,
    type: "email_sent",
    subject: `Email sent: ${resolvedSubject}`,
    contact_id: contactId,
    metadata: {
      manual: true,
      email_queue_id: queueRow.id,
      tracking_id: trackingId,
      gmail_message_id: result.messageId ?? null,
      gmail_thread_id: result.threadId ?? null,
      sender_account_id: senderId,
      sender_email: senderAccount?.email_address ?? null,
      sender_name: senderAccount?.display_name ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    messageId: result.messageId ?? null,
    sender_email: senderAccount?.email_address ?? null,
  });
}
