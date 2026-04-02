import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getGmailClient } from "@/lib/gmail/client";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  let checked = 0;
  let repliesFound = 0;
  let autoRepliesFound = 0;
  let bouncesFound = 0;

  // --- Reply Detection ---
  // Get sent emails with a thread ID from the last 60 days
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: sentEmails } = await supabase
    .from("email_queue")
    .select("id, tracking_id, contact_id, workspace_id, sender_account_id, to_email, gmail_thread_id, enrollment_id")
    .eq("status", "sent")
    .not("gmail_thread_id", "is", null)
    .gte("sent_at", since);

  if (sentEmails && sentEmails.length > 0) {
    // Group by (sender_account_id, gmail_thread_id) — one API call per thread
    const threadMap = new Map<string, typeof sentEmails[0]>();
    for (const email of sentEmails) {
      if (!email.gmail_thread_id) continue;
      const key = `${email.sender_account_id}::${email.gmail_thread_id}`;
      if (!threadMap.has(key)) {
        threadMap.set(key, email);
      }
    }

    // Get sender account email addresses for filtering
    const senderIds = [...new Set(sentEmails.map((e) => e.sender_account_id))];
    const { data: accounts } = await supabase
      .from("gmail_accounts")
      .select("id, email_address, workspace_id")
      .in("id", senderIds);

    const accountMap = new Map(accounts?.map((a) => [a.id, a]) ?? []);

    for (const [, email] of threadMap) {
      checked++;
      const account = accountMap.get(email.sender_account_id);
      if (!account) continue;

      try {
        const tokenResult = await getValidAccessToken(email.sender_account_id);
        if ("error" in tokenResult) continue;

        const gmail = getGmailClient(tokenResult.accessToken);
        const { data: thread } = await gmail.users.threads.get({
          userId: "me",
          id: email.gmail_thread_id!,
          format: "full",
        });

        if (!thread?.messages) continue;

        // Track real vs auto replies found in this thread
        let threadRealReplies = 0;
        let createdFollowUpTask = false;

        for (const message of thread.messages) {
          if (!message.id || !message.payload) continue;

          const headers = message.payload.headers ?? [];
          const fromHeader = getHeader(headers, "from");
          const { email: fromEmail, name: fromName } = parseEmailAddress(fromHeader);

          // Skip messages we sent
          if (fromEmail.toLowerCase() === account.email_address.toLowerCase()) continue;

          // Skip already-stored messages
          const { data: existing } = await supabase
            .from("inbox_messages")
            .select("id")
            .eq("gmail_message_id", message.id)
            .maybeSingle();

          if (existing) continue;

          // Parse message
          const subject = getHeader(headers, "subject");
          const dateHeader = getHeader(headers, "date");
          const receivedAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
          const bodyText = extractTextBody(message.payload);
          const bodyHtml = extractHtmlBody(message.payload);

          // Detect OOO / auto-reply
          const autoReply = isAutoReply(headers, subject, bodyText);

          // Find the email_queue row for this thread
          const threadEmail = sentEmails.find(
            (e) =>
              e.gmail_thread_id === email.gmail_thread_id &&
              e.sender_account_id === email.sender_account_id
          );

          // Look up contact by from email
          const { data: contact } = await supabase
            .from("contacts")
            .select("id, first_name, last_name")
            .eq("workspace_id", account.workspace_id)
            .eq("email", fromEmail.toLowerCase())
            .maybeSingle();

          // Insert into inbox_messages
          await supabase.from("inbox_messages").insert({
            workspace_id: account.workspace_id,
            gmail_account_id: account.id,
            gmail_message_id: message.id,
            gmail_thread_id: email.gmail_thread_id!,
            email_queue_id: threadEmail?.id ?? null,
            contact_id: contact?.id ?? null,
            from_email: fromEmail,
            from_name: fromName || null,
            subject: subject || null,
            body_html: bodyHtml || null,
            body_text: bodyText || null,
            received_at: receivedAt,
            is_auto_reply: autoReply,
            category: autoReply ? "out_of_office" : "inbox",
          });

          // Insert email_event for reply (always, even for OOO — for stats)
          if (threadEmail?.tracking_id) {
            await supabase.from("email_events").insert({
              tracking_id: threadEmail.tracking_id,
              email_queue_id: threadEmail.id,
              event_type: "reply",
            });
          }

          // Update contact last_contacted_at (only for real replies)
          if (!autoReply && contact?.id) {
            await supabase
              .from("contacts")
              .update({ last_contacted_at: new Date().toISOString() })
              .eq("id", contact.id);
          }

          // Create activity record
          await supabase.from("activities").insert({
            workspace_id: account.workspace_id,
            type: "email_received",
            subject: autoReply ? "Auto-reply received (OOO)" : "Reply received",
            description: autoReply
              ? `Out-of-office auto-reply from ${fromEmail}`
              : `Reply from ${fromEmail}`,
            contact_id: contact?.id ?? null,
            metadata: {
              gmail_message_id: message.id,
              gmail_thread_id: email.gmail_thread_id,
              email_queue_id: threadEmail?.id ?? null,
              is_auto_reply: autoReply,
            },
          });

          if (autoReply) {
            autoRepliesFound++;
          } else {
            repliesFound++;
            threadRealReplies++;

            // Auto-create a task for any non-enrollment real reply (lower priority)
            if (!autoReply && contact?.id && !createdFollowUpTask && !email.enrollment_id) {
              await supabase.from("tasks").insert({
                workspace_id: account.workspace_id,
                contact_id: contact.id,
                type: "email",
                title: `Reply from ${contact.first_name || fromEmail}`,
                description: "Review and respond to their reply in Inbox.",
                due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                priority: "medium",
              });
              createdFollowUpTask = true;
            }
          }
        }

        // Handle stop_on_reply for enrollment — only for real (non-OOO) replies
        if (threadRealReplies > 0 && email.enrollment_id) {
          const { data: enrollment } = await supabase
            .from("sequence_enrollments")
            .select("*, sequences(*), contacts(id, company_id, first_name, last_name)")
            .eq("id", email.enrollment_id)
            .eq("status", "active")
            .maybeSingle();

          if (enrollment) {
            const sequence = enrollment.sequences as unknown as {
              id: string;
              settings: { stop_on_reply?: boolean; stop_on_company_reply?: boolean };
            };

            if (sequence?.settings?.stop_on_reply) {
              // Mark this enrollment as replied
              await supabase
                .from("sequence_enrollments")
                .update({ status: "replied", completed_at: new Date().toISOString() })
                .eq("id", enrollment.id);

              await supabase
                .from("email_queue")
                .update({ status: "cancelled" as const })
                .eq("enrollment_id", enrollment.id)
                .eq("status", "scheduled");

              // Auto-create follow-up task for the replied enrollment
              {
                const enrollmentContact = enrollment.contacts as unknown as {
                  id: string;
                  first_name: string | null;
                  last_name: string | null;
                  company_id: string | null;
                } | null;
                const seqName = (enrollment.sequences as unknown as { name: string })?.name ?? "sequence";
                const contactName = enrollmentContact
                  ? [enrollmentContact.first_name, enrollmentContact.last_name].filter(Boolean).join(" ") || "contact"
                  : "contact";
                if (enrollmentContact?.id) {
                  await supabase.from("tasks").insert({
                    workspace_id: account.workspace_id,
                    contact_id: enrollmentContact.id,
                    enrollment_id: enrollment.id,
                    type: "email",
                    title: `Follow up with ${contactName || "contact"} — replied to "${seqName}"`,
                    description: "They replied to your sequence. Review their reply in Inbox and respond.",
                    due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    priority: "high",
                  });
                  createdFollowUpTask = true;
                }
              }

              // Company-level stop: pause other active enrollments at the same company
              const stopOnCompanyReply = sequence?.settings?.stop_on_company_reply ?? true;
              const contact = enrollment.contacts as unknown as { company_id: string | null } | null;
              const companyId = contact?.company_id;

              if (stopOnCompanyReply && companyId) {
                // Find company name for activity description
                const { data: company } = await supabase
                  .from("companies")
                  .select("name")
                  .eq("id", companyId)
                  .maybeSingle();

                // Find all other active enrollments for contacts at this company
                const { data: companyContacts } = await supabase
                  .from("contacts")
                  .select("id")
                  .eq("workspace_id", account.workspace_id)
                  .eq("company_id", companyId)
                  .neq("id", enrollment.contact_id);

                if (companyContacts && companyContacts.length > 0) {
                  const companyContactIds = companyContacts.map((c) => c.id);

                  const { data: otherEnrollments } = await supabase
                    .from("sequence_enrollments")
                    .select("id, contact_id")
                    .in("contact_id", companyContactIds)
                    .eq("status", "active");

                  if (otherEnrollments && otherEnrollments.length > 0) {
                    const otherIds = otherEnrollments.map((e) => e.id);

                    await supabase
                      .from("sequence_enrollments")
                      .update({ status: "company_paused" })
                      .in("id", otherIds);

                    await supabase
                      .from("email_queue")
                      .update({ status: "cancelled" as const })
                      .in("enrollment_id", otherIds)
                      .eq("status", "scheduled");

                    // Create activity records for each paused contact
                    const companyName = company?.name ?? "their company";
                    const activityInserts = otherEnrollments.map((e) => ({
                      workspace_id: account.workspace_id,
                      type: "sequence_paused",
                      subject: "Sequence paused — company reply",
                      description: `Sequence paused — reply received from another contact at ${companyName}`,
                      contact_id: e.contact_id,
                      metadata: {
                        reason: "company_reply",
                        company_id: companyId,
                        replying_enrollment_id: enrollment.id,
                      },
                    }));
                    await supabase.from("activities").insert(activityInserts);
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Reply check failed for thread ${email.gmail_thread_id}:`, err);
      }
    }
  }

  // --- Bounce Detection ---
  const { data: activeSentEmails } = await supabase
    .from("email_queue")
    .select("sender_account_id, tracking_id, id, contact_id, workspace_id, to_email")
    .eq("status", "sent")
    .gte("sent_at", since);

  if (activeSentEmails && activeSentEmails.length > 0) {
    const uniqueSenderIds = [...new Set(activeSentEmails.map((e) => e.sender_account_id))];

    for (const senderAccountId of uniqueSenderIds) {
      try {
        const tokenResult = await getValidAccessToken(senderAccountId);
        if ("error" in tokenResult) continue;

        const gmail = getGmailClient(tokenResult.accessToken);

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

          const bodyText = extractTextBody(fullMessage.payload);
          if (!bodyText) continue;

          const senderEmails = activeSentEmails.filter(
            (e) => e.sender_account_id === senderAccountId
          );

          for (const sentEmail of senderEmails) {
            if (bodyText.toLowerCase().includes(sentEmail.to_email.toLowerCase())) {
              const { data: existingBounce } = await supabase
                .from("email_events")
                .select("id")
                .eq("tracking_id", sentEmail.tracking_id)
                .eq("event_type", "bounce")
                .limit(1);

              if (existingBounce && existingBounce.length > 0) continue;

              await supabase.from("email_events").insert({
                tracking_id: sentEmail.tracking_id,
                email_queue_id: sentEmail.id,
                event_type: "bounce",
              });

              if (sentEmail.contact_id) {
                await supabase
                  .from("contacts")
                  .update({ status: "bounced" })
                  .eq("id", sentEmail.contact_id);

                // Add to suppressions list
                const { data: existingBounceSuppression } = await supabase
                  .from("suppressions")
                  .select("id")
                  .eq("workspace_id", sentEmail.workspace_id)
                  .eq("email", sentEmail.to_email)
                  .eq("active", true)
                  .maybeSingle();

                if (!existingBounceSuppression) {
                  await supabase.from("suppressions").insert({
                    workspace_id: sentEmail.workspace_id,
                    email: sentEmail.to_email,
                    reason: "bounced",
                    source: "bounce detected by check-replies cron",
                  });
                }

                const { data: contactEnrollments } = await supabase
                  .from("sequence_enrollments")
                  .select("id")
                  .eq("contact_id", sentEmail.contact_id)
                  .in("status", ["active", "paused"]);

                if (contactEnrollments && contactEnrollments.length > 0) {
                  const ids = contactEnrollments.map((e) => e.id);
                  await supabase
                    .from("sequence_enrollments")
                    .update({ status: "bounced", completed_at: new Date().toISOString() })
                    .in("id", ids);
                  await supabase
                    .from("email_queue")
                    .update({ status: "cancelled" as const })
                    .in("enrollment_id", ids)
                    .eq("status", "scheduled");
                }

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

  return NextResponse.json({ checked, repliesFound, autoRepliesFound, bouncesFound });
}

function isAutoReply(
  headers: Array<{ name?: string | null; value?: string | null }>,
  subject: string,
  bodyText: string | null
): boolean {
  // Header checks (most reliable)
  const autoSubmitted = getHeader(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;

  const xAutoReply = getHeader(headers, "x-autoreply");
  if (xAutoReply) return true;

  const xAutoResponseSuppress = getHeader(headers, "x-auto-response-suppress");
  if (xAutoResponseSuppress) return true;

  const precedence = getHeader(headers, "precedence");
  if (precedence && ["bulk", "auto_reply", "junk"].includes(precedence.toLowerCase())) return true;

  // Subject checks (multilingual — we email Nordic workshops)
  const subjectLower = subject.toLowerCase();
  const oooPatterns = [
    "out of office",
    "automatic reply",
    "auto-reply",
    "autoreply",
    "frånvarande", // Swedish
    "automatiskt svar", // Swedish
    "fraværende", // Norwegian/Danish
    "automatisk svar", // Norwegian/Danish
    "abwesenheit", // German
    "automatische antwort", // German
    "poissa", // Finnish
    "automaattinen vastaus", // Finnish
  ];
  if (oooPatterns.some((p) => subjectLower.includes(p))) return true;

  void bodyText; // reserved for future body-based heuristics

  return false;
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function parseEmailAddress(from: string): { name: string; email: string } {
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "", email: from.trim() };
}

type GmailPayload = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPayload[] | null;
};

function extractTextBody(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractTextBody(part);
      if (result) return result;
    }
  }
  return null;
}

function extractHtmlBody(payload: GmailPayload): string | null {
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractHtmlBody(part);
      if (result) return result;
    }
  }
  return null;
}

// Vercel Cron Jobs send GET requests — alias POST handler
export const GET = POST;
