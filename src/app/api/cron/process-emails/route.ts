import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/gmail/send";
import { resolveVariables, ensureUnsubscribeLink } from "@/lib/sequences/variables";
import { getNextSendTime, calculateStepScheduleTime } from "@/lib/sequences/scheduler";
import type { SequenceSettings } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Get scheduled emails that are due
  const { data: queueItems, error: queueError } = await supabase
    .from("email_queue")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for")
    .limit(100);

  if (queueError || !queueItems || queueItems.length === 0) {
    return NextResponse.json({ processed: 0, message: "No emails to process" });
  }

  // Group by sender to respect daily limits
  const bySender = new Map<string, typeof queueItems>();
  for (const item of queueItems) {
    const group = bySender.get(item.sender_account_id) || [];
    group.push(item);
    bySender.set(item.sender_account_id, group);
  }

  let processed = 0;
  let failed = 0;

  for (const [senderAccountId, items] of bySender) {
    // Check sender daily limit
    const { data: account } = await supabase
      .from("gmail_accounts")
      .select("daily_sends_count, max_daily_sends, status")
      .eq("id", senderAccountId)
      .single();

    if (!account || account.status !== "active") continue;
    const remaining = account.max_daily_sends - account.daily_sends_count;
    if (remaining <= 0) continue;

    const toProcess = items.slice(0, remaining);

    for (const item of toProcess) {
      // Mark as sending
      await supabase
        .from("email_queue")
        .update({ status: "sending" as const })
        .eq("id", item.id);

      // Check enrollment is still active
      const { data: enrollment } = await supabase
        .from("sequence_enrollments")
        .select("*, sequences(*)")
        .eq("id", item.enrollment_id)
        .single();

      if (!enrollment || enrollment.status !== "active") {
        await supabase
          .from("email_queue")
          .update({ status: "cancelled" as const })
          .eq("id", item.id);
        continue;
      }

      // Check contact not unsubscribed
      const { data: unsub } = await supabase
        .from("unsubscribes")
        .select("id")
        .eq("workspace_id", item.workspace_id)
        .eq("email", item.to_email)
        .maybeSingle();

      if (unsub) {
        await supabase
          .from("email_queue")
          .update({ status: "cancelled" as const })
          .eq("id", item.id);
        await supabase
          .from("sequence_enrollments")
          .update({ status: "unsubscribed" })
          .eq("id", item.enrollment_id);
        continue;
      }

      // Send the email
      const result = await sendEmail({
        accountId: senderAccountId,
        to: item.to_email,
        subject: item.subject,
        htmlBody: item.body_html,
        trackingId: item.tracking_id,
      });

      if (result.success) {
        // Update queue entry
        await supabase
          .from("email_queue")
          .update({
            status: "sent" as const,
            sent_at: new Date().toISOString(),
            gmail_message_id: result.messageId || null,
          })
          .eq("id", item.id);

        // Create activity record
        await supabase.from("activities").insert({
          workspace_id: item.workspace_id,
          type: "email_sent",
          subject: `Email sent: ${item.subject}`,
          contact_id: item.contact_id,
          metadata: {
            sequence_id: enrollment.sequence_id,
            enrollment_id: enrollment.id,
            email_queue_id: item.id,
          },
        });

        // Advance enrollment
        const currentStep = enrollment.current_step;
        const nextStepOrder = currentStep + 1;

        await supabase
          .from("sequence_enrollments")
          .update({ current_step: nextStepOrder })
          .eq("id", enrollment.id);

        // Schedule next step
        const { data: nextStep } = await supabase
          .from("sequence_steps")
          .select("*")
          .eq("sequence_id", enrollment.sequence_id)
          .eq("step_order", nextStepOrder)
          .single();

        if (nextStep) {
          const sequence = enrollment.sequences as unknown as { settings: SequenceSettings };
          const settings = sequence?.settings;

          if (nextStep.type === "email" && settings) {
            // Get contact and company for variable resolution
            const { data: contact } = await supabase
              .from("contacts")
              .select("*, companies(*)")
              .eq("id", item.contact_id)
              .single();

            if (contact) {
              let subject = nextStep.subject_override || "";
              let bodyHtml = nextStep.body_override || "";

              if (nextStep.template_id) {
                const { data: template } = await supabase
                  .from("email_templates")
                  .select("*")
                  .eq("id", nextStep.template_id)
                  .single();
                if (template) {
                  subject = nextStep.subject_override || template.subject;
                  bodyHtml = nextStep.body_override || template.body_html;
                }
              }

              const company = (contact as Record<string, unknown>).companies as never;
              const trackingId = crypto.randomUUID();

              subject = resolveVariables(subject, contact, company, trackingId);
              bodyHtml = resolveVariables(bodyHtml, contact, company, trackingId);
              bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);

              const scheduledFor = getNextSendTime(settings);

              await supabase.from("email_queue").insert({
                workspace_id: item.workspace_id,
                enrollment_id: enrollment.id,
                step_id: nextStep.id,
                contact_id: item.contact_id,
                sender_account_id: senderAccountId,
                to_email: item.to_email,
                subject,
                body_html: bodyHtml,
                status: "scheduled" as const,
                scheduled_for: scheduledFor.toISOString(),
                tracking_id: trackingId,
              });
            }
          } else if (nextStep.type === "delay" && settings) {
            // Calculate when delay ends, then look at the step after
            const delayEnd = calculateStepScheduleTime(
              settings,
              nextStep.delay_days || 0,
              nextStep.delay_hours || 0
            );

            // Advance past the delay step
            await supabase
              .from("sequence_enrollments")
              .update({ current_step: nextStepOrder + 1 })
              .eq("id", enrollment.id);

            // Find the step after the delay
            const { data: stepAfterDelay } = await supabase
              .from("sequence_steps")
              .select("*")
              .eq("sequence_id", enrollment.sequence_id)
              .eq("step_order", nextStepOrder + 1)
              .single();

            if (stepAfterDelay && stepAfterDelay.type === "email") {
              const { data: contact } = await supabase
                .from("contacts")
                .select("*, companies(*)")
                .eq("id", item.contact_id)
                .single();

              if (contact) {
                let subject = stepAfterDelay.subject_override || "";
                let bodyHtml = stepAfterDelay.body_override || "";

                if (stepAfterDelay.template_id) {
                  const { data: template } = await supabase
                    .from("email_templates")
                    .select("*")
                    .eq("id", stepAfterDelay.template_id)
                    .single();
                  if (template) {
                    subject = stepAfterDelay.subject_override || template.subject;
                    bodyHtml = stepAfterDelay.body_override || template.body_html;
                  }
                }

                const company = (contact as Record<string, unknown>).companies as never;
                const trackingId = crypto.randomUUID();

                subject = resolveVariables(subject, contact, company, trackingId);
                bodyHtml = resolveVariables(bodyHtml, contact, company, trackingId);
                bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);

                await supabase.from("email_queue").insert({
                  workspace_id: item.workspace_id,
                  enrollment_id: enrollment.id,
                  step_id: stepAfterDelay.id,
                  contact_id: item.contact_id,
                  sender_account_id: senderAccountId,
                  to_email: item.to_email,
                  subject,
                  body_html: bodyHtml,
                  status: "scheduled" as const,
                  scheduled_for: delayEnd.toISOString(),
                  tracking_id: trackingId,
                });
              }
            }
          }
          // Condition steps would be handled similarly (check events, branch)
        } else {
          // No more steps — mark enrollment as completed
          await supabase
            .from("sequence_enrollments")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
            })
            .eq("id", enrollment.id);
        }

        processed++;
      } else {
        // Send failed — retry logic
        const retryCount = (item as unknown as { retry_count?: number }).retry_count || 0;

        if (retryCount < 3) {
          const retryAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min later
          await supabase
            .from("email_queue")
            .update({
              status: "scheduled" as const,
              scheduled_for: retryAt.toISOString(),
            })
            .eq("id", item.id);
        } else {
          await supabase
            .from("email_queue")
            .update({ status: "failed" as const })
            .eq("id", item.id);
        }

        failed++;
      }
    }
  }

  return NextResponse.json({ processed, failed });
}
