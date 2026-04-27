import { createClient } from "@/lib/supabase/server";
import { getNextSender } from "@/lib/gmail/sender-rotation";
import { resolveVariables, ensureUnsubscribeLink } from "./variables";
import { getNextSendTime, calculateStepScheduleTime } from "./scheduler";
import type { SequenceSettings } from "@/lib/database.types";

interface EnrollParams {
  sequenceId: string;
  contactIds: string[];
  workspaceId: string;
  senderAccountId?: string;
}

interface EnrollResult {
  enrolled: number;
  skipped: number;
  reasons: string[];
}

export async function enrollContacts(params: EnrollParams): Promise<EnrollResult> {
  const { sequenceId, contactIds, workspaceId, senderAccountId } = params;
  const supabase = await createClient();
  const result: EnrollResult = { enrolled: 0, skipped: 0, reasons: [] };

  // Get the sequence
  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("workspace_id", workspaceId)
    .single();

  if (seqError || !sequence) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["Sequence not found"] };
  }

  if (!["active", "draft", "paused"].includes(sequence.status)) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["Sequence is not active, draft, or paused"] };
  }

  // Get unsubscribed emails for this workspace
  const { data: unsubscribes } = await supabase
    .from("unsubscribes")
    .select("email")
    .eq("workspace_id", workspaceId);
  const unsubEmails = new Set((unsubscribes || []).map((u) => u.email.toLowerCase()));

  // Get existing enrollments for this sequence
  const { data: existingEnrollments } = await supabase
    .from("sequence_enrollments")
    .select("contact_id")
    .eq("sequence_id", sequenceId);
  const enrolledContactIds = new Set((existingEnrollments || []).map((e) => e.contact_id));

  // Get the first step
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("step_order", { ascending: true });

  const firstStep = steps?.[0];

  // Get contacts
  const { data: contacts } = await supabase
    .from("contacts")
    .select("*, companies(*)")
    .in("id", contactIds)
    .eq("workspace_id", workspaceId);

  if (!contacts) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["No contacts found"] };
  }

  const settings = sequence.settings as SequenceSettings;

  for (const contact of contacts) {
    // Validation checks
    if (enrolledContactIds.has(contact.id)) {
      result.skipped++;
      result.reasons.push(`${contact.email}: Already enrolled`);
      continue;
    }

    if (unsubEmails.has(contact.email.toLowerCase())) {
      result.skipped++;
      result.reasons.push(`${contact.email}: Unsubscribed`);
      continue;
    }

    if (contact.status !== "active") {
      result.skipped++;
      result.reasons.push(`${contact.email}: Contact status is ${contact.status}`);
      continue;
    }

    // Determine sender
    let assignedSenderId = senderAccountId;
    if (!assignedSenderId) {
      const rotationPool = settings.rotation_account_ids;
      const hasPool = Array.isArray(rotationPool) && rotationPool.length > 0;
      const sender = await getNextSender(workspaceId, hasPool ? rotationPool : undefined);
      if (!sender) {
        result.skipped++;
        result.reasons.push(
          hasPool
            ? `${contact.email}: No accounts in this sequence's rotation pool have capacity`
            : `${contact.email}: No available sender accounts`
        );
        continue;
      }
      assignedSenderId = sender.id;
    }

    // Create enrollment — pin the sender so all steps use the same account
    const { data: enrollment, error: enrollError } = await supabase
      .from("sequence_enrollments")
      .insert({
        sequence_id: sequenceId,
        contact_id: contact.id,
        sender_account_id: assignedSenderId,
        status: "active",
        current_step: 0,
      })
      .select()
      .single();

    if (enrollError) {
      result.skipped++;
      result.reasons.push(`${contact.email}: ${enrollError.message}`);
      continue;
    }

    // Schedule the first step if it's an email
    // For draft/paused sequences, queue as "pending" — emails won't send until sequence is activated
    const emailStatus = (["draft", "paused"].includes(sequence.status) ? "pending" : "scheduled") as "scheduled" | "pending";

    if (firstStep && firstStep.type === "email" && enrollment) {
      const scheduledFor = getNextSendTime(settings);

      // Get template content
      let subject = firstStep.subject_override || "";
      let bodyHtml = firstStep.body_override || "";

      if (firstStep.template_id) {
        const { data: template } = await supabase
          .from("email_templates")
          .select("*")
          .eq("id", firstStep.template_id)
          .single();

        if (template) {
          subject = firstStep.subject_override || template.subject;
          bodyHtml = firstStep.body_override || template.body_html;
        }
      }

      const company = (contact as Record<string, unknown>).companies as typeof contact.company_id extends string ? { name: string } : null;
      const trackingId = crypto.randomUUID();

      // Resolve variables
      subject = resolveVariables(subject, contact, company as never, trackingId);
      bodyHtml = resolveVariables(bodyHtml, contact, company as never, trackingId);
      bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);

      const { error: queueError } = await supabase.from("email_queue").insert({
        workspace_id: workspaceId,
        enrollment_id: enrollment.id,
        step_id: firstStep.id,
        contact_id: contact.id,
        sender_account_id: assignedSenderId,
        to_email: contact.email,
        subject,
        body_html: bodyHtml,
        status: emailStatus,
        scheduled_for: scheduledFor.toISOString(),
        tracking_id: trackingId,
      });
      if (queueError) {
        await supabase.from("sequence_enrollments").delete().eq("id", enrollment.id);
        result.skipped++;
        result.reasons.push(`${contact.email}: Failed to queue first email — ${queueError.message}`);
        continue;
      }
    } else if (firstStep && firstStep.type === "delay" && enrollment) {
      // For delay steps, calculate when the delay ends and schedule the next step
      const delayEnd = calculateStepScheduleTime(
        settings,
        firstStep.delay_days || 0,
        firstStep.delay_hours || 0
      );

      // Find next step after delay
      const nextStep = steps?.find((s) => s.step_order === firstStep.step_order + 1);
      if (nextStep && nextStep.type === "email") {
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

        const { error: delayQueueError } = await supabase.from("email_queue").insert({
          workspace_id: workspaceId,
          enrollment_id: enrollment.id,
          step_id: nextStep.id,
          contact_id: contact.id,
          sender_account_id: assignedSenderId,
          to_email: contact.email,
          subject,
          body_html: bodyHtml,
          status: emailStatus,
          scheduled_for: delayEnd.toISOString(),
          tracking_id: trackingId,
        });
        if (delayQueueError) {
          await supabase.from("sequence_enrollments").delete().eq("id", enrollment.id);
          result.skipped++;
          result.reasons.push(`${contact.email}: Failed to queue first email — ${delayQueueError.message}`);
          continue;
        }
      }
    }

    result.enrolled++;
    enrolledContactIds.add(contact.id);
  }

  return result;
}
