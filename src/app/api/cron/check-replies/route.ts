import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailClient } from "@/lib/gmail/client";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";
import type { SequenceSettings } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Get all active enrollments
  const { data: enrollments, error } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*)")
    .eq("status", "active");

  if (error || !enrollments || enrollments.length === 0) {
    return NextResponse.json({ checked: 0, repliesFound: 0, bouncesFound: 0 });
  }

  let checked = 0;
  let repliesFound = 0;
  let bouncesFound = 0;

  for (const enrollment of enrollments) {
    checked++;

    // Check for reply events on emails sent in this enrollment
    const { data: sentEmails } = await supabase
      .from("email_queue")
      .select("id, tracking_id, contact_id, sender_account_id, to_email")
      .eq("enrollment_id", enrollment.id)
      .eq("status", "sent");

    if (!sentEmails || sentEmails.length === 0) continue;

    const trackingIds = sentEmails.map((e) => e.tracking_id).filter(Boolean);
    if (trackingIds.length === 0) continue;

    // Check for reply events
    const { data: replyEvents } = await supabase
      .from("email_events")
      .select("id")
      .in("tracking_id", trackingIds)
      .eq("event_type", "reply")
      .limit(1);

    if (replyEvents && replyEvents.length > 0) {
      const sequence = enrollment.sequences as unknown as { settings: SequenceSettings };
      const settings = sequence?.settings;

      if (settings?.stop_on_reply) {
        // Update enrollment status to replied
        await supabase
          .from("sequence_enrollments")
          .update({
            status: "replied",
            completed_at: new Date().toISOString(),
          })
          .eq("id", enrollment.id);

        // Cancel all scheduled emails for this enrollment
        await supabase
          .from("email_queue")
          .update({ status: "cancelled" as const })
          .eq("enrollment_id", enrollment.id)
          .eq("status", "scheduled");

        // Create activity record
        const contactId = sentEmails[0]?.contact_id;
        if (contactId) {
          await supabase.from("activities").insert({
            workspace_id: (enrollment.sequences as { workspace_id: string }).workspace_id,
            type: "email_received",
            subject: "Reply received",
            description: "Contact replied to sequence email",
            contact_id: contactId,
            metadata: {
              sequence_id: enrollment.sequence_id,
              enrollment_id: enrollment.id,
            },
          });

          // Update contact's last_contacted_at
          await supabase
            .from("contacts")
            .update({ last_contacted_at: new Date().toISOString() })
            .eq("id", contactId);
        }

        repliesFound++;
      }
    }
  }

  // --- Bounce Detection ---
  // Get unique sender accounts from all sent emails in active enrollments
  const { data: activeSentEmails } = await supabase
    .from("email_queue")
    .select("sender_account_id, tracking_id, id, contact_id, workspace_id, to_email")
    .in(
      "enrollment_id",
      enrollments.map((e) => e.id)
    )
    .eq("status", "sent");

  if (activeSentEmails && activeSentEmails.length > 0) {
    const uniqueSenderIds = [...new Set(activeSentEmails.map((e) => e.sender_account_id))];

    for (const senderAccountId of uniqueSenderIds) {
      try {
        const tokenResult = await getValidAccessToken(senderAccountId);
        if ("error" in tokenResult) continue;

        const gmail = getGmailClient(tokenResult.accessToken);

        // Search for bounce messages from mailer-daemon or postmaster
        const { data: messages } = await gmail.users.messages.list({
          userId: "me",
          q: "from:(mailer-daemon@* OR postmaster@*) newer_than:1d",
          maxResults: 50,
        });

        if (!messages?.messages) continue;

        for (const msg of messages.messages) {
          if (!msg.id) continue;

          const { data: fullMessage } = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });

          if (!fullMessage?.payload) continue;

          // Extract bounce email body to find the bounced email address
          const bodyText = extractMessageBody(fullMessage.payload);
          if (!bodyText) continue;

          // Find which of our sent emails bounced
          const senderEmails = activeSentEmails.filter(
            (e) => e.sender_account_id === senderAccountId
          );

          for (const sentEmail of senderEmails) {
            if (
              bodyText.toLowerCase().includes(sentEmail.to_email.toLowerCase())
            ) {
              // Check if we already logged a bounce for this tracking_id
              const { data: existingBounce } = await supabase
                .from("email_events")
                .select("id")
                .eq("tracking_id", sentEmail.tracking_id)
                .eq("event_type", "bounce")
                .limit(1);

              if (existingBounce && existingBounce.length > 0) continue;

              // Log bounce event
              await supabase.from("email_events").insert({
                tracking_id: sentEmail.tracking_id,
                email_queue_id: sentEmail.id,
                event_type: "bounce",
              });

              // Update contact status to bounced
              if (sentEmail.contact_id) {
                await supabase
                  .from("contacts")
                  .update({ status: "bounced" })
                  .eq("id", sentEmail.contact_id);

                // Cancel all active enrollments for this contact
                const { data: contactEnrollments } = await supabase
                  .from("sequence_enrollments")
                  .select("id")
                  .eq("contact_id", sentEmail.contact_id)
                  .in("status", ["active", "paused"]);

                if (contactEnrollments && contactEnrollments.length > 0) {
                  const ids = contactEnrollments.map((e) => e.id);

                  await supabase
                    .from("sequence_enrollments")
                    .update({
                      status: "bounced",
                      completed_at: new Date().toISOString(),
                    })
                    .in("id", ids);

                  await supabase
                    .from("email_queue")
                    .update({ status: "cancelled" as const })
                    .in("enrollment_id", ids)
                    .eq("status", "scheduled");
                }

                // Create activity record
                await supabase.from("activities").insert({
                  workspace_id: sentEmail.workspace_id,
                  type: "email_bounced",
                  subject: "Email bounced",
                  description: `Email to ${sentEmail.to_email} bounced`,
                  contact_id: sentEmail.contact_id,
                  metadata: {
                    tracking_id: sentEmail.tracking_id,
                    email_queue_id: sentEmail.id,
                  },
                });
              }

              bouncesFound++;
            }
          }
        }
      } catch (err) {
        console.error(`Bounce check failed for account ${senderAccountId}:`, err);
      }
    }
  }

  return NextResponse.json({ checked, repliesFound, bouncesFound });
}

/**
 * Extracts the text body from a Gmail message payload (recursive for multipart).
 */
function extractMessageBody(
  payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] }> | null }
): string | null {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractMessageBody(part as typeof payload);
      if (result) return result;
    }
  }

  // Fallback: try HTML body
  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    return html.replace(/<[^>]*>/g, "");
  }

  return null;
}

// Vercel Cron Jobs send GET requests — alias POST handler
export const GET = POST;
