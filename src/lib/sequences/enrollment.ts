import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getNextSender } from "@/lib/gmail/sender-rotation";
import { resolveVariables, ensureUnsubscribeLink } from "./variables";
import { calculateStepScheduleTime } from "./scheduler";
import { walkFromStep } from "./step-walk";
import { createStepTasks } from "./step-tasks";
import {
  createBatchVariantPicker,
  fetchVariantsByStepId,
  flushSendCountDeltas,
} from "./variants";
import { defaultLanguage, resolveContactLanguage } from "./language";
import type { Database, SequenceSettings, Tables } from "@/lib/database.types";

type ContactWithCompany = Tables<"contacts"> & {
  companies: Tables<"companies"> | null;
};

type EmailTemplate = Pick<Tables<"email_templates">, "id" | "subject" | "body_html">;

/**
 * Contacts carrying any of these tags have already been sequenced via a prior
 * outreach tool (e.g. Lemlist) — enrolling them again would double-send.
 * The `allowAlreadySequenced` param overrides this check (used by Field Routes
 * after a visit, where Hans deliberately re-engages).
 */
export const ALREADY_SEQUENCED_TAGS = ["lemlist-csv"] as const;

interface EnrollParams {
  sequenceId: string;
  contactIds: string[];
  workspaceId: string;
  senderAccountId?: string;
  /** Bypass the ALREADY_SEQUENCED_TAGS guard. Default false. */
  allowAlreadySequenced?: boolean;
  /**
   * Bypass the "contact is an existing wl-app user / customer workshop" guard.
   * Default false. Used for deliberate follow-up sequences (e.g. a post-call
   * "thanks for the conversation" message) where you DO want to email an
   * existing customer.
   */
  allowCustomers?: boolean;
}

interface EnrollResult {
  enrolled: number;
  skipped: number;
  reasons: string[];
  /** Subset of `skipped` that hit the ALREADY_SEQUENCED_TAGS guard. */
  skippedAlreadySequenced: number;
  /** Subset of `skipped` that were skipped for being a wl-app user / workshop. */
  skippedCustomer: number;
}

export async function enrollContacts(
  params: EnrollParams,
  supabaseClient?: SupabaseClient<Database>,
): Promise<EnrollResult> {
  const { sequenceId, contactIds, workspaceId, senderAccountId, allowAlreadySequenced = false, allowCustomers = false } = params;
  const supabase = supabaseClient ?? (await createClient());
  const result: EnrollResult = { enrolled: 0, skipped: 0, reasons: [], skippedAlreadySequenced: 0, skippedCustomer: 0 };

  // Get the sequence
  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("workspace_id", workspaceId)
    .single();

  if (seqError || !sequence) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["Sequence not found"], skippedAlreadySequenced: 0, skippedCustomer: 0 };
  }

  if (!["active", "draft", "paused"].includes(sequence.status ?? "")) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["Sequence is not active, draft, or paused"], skippedAlreadySequenced: 0, skippedCustomer: 0 };
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

  // Get every step — the opening of the sequence may be several non-email
  // steps (delays, calls, tasks) before the first email.
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("step_order", { ascending: true });

  // Get contacts. PostgREST puts the IN list in the URL, so a single .in() with
  // ~1000+ UUIDs blows past the URL length limit and the request fails with
  // "Bad Request". Chunk to keep each request safe.
  const CHUNK_SIZE = 200;
  const contacts: ContactWithCompany[] = [];
  for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
    const chunk = contactIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("contacts")
      .select("*, companies(*)")
      .in("id", chunk)
      .eq("workspace_id", workspaceId);
    if (error) {
      return { enrolled: 0, skipped: contactIds.length, reasons: [`Failed to load contacts: ${error.message}`], skippedAlreadySequenced: 0, skippedCustomer: 0 };
    }
    if (data) contacts.push(...(data as unknown as ContactWithCompany[]));
  }

  if (contacts.length === 0) {
    return { enrolled: 0, skipped: contactIds.length, reasons: ["No contacts found"], skippedAlreadySequenced: 0, skippedCustomer: 0 };
  }

  const settings = sequence.settings as SequenceSettings;

  // A sequence already flagged as a customer follow-up implicitly allows
  // customers, so a later enroll without the explicit param still works.
  const effectiveAllowCustomers = allowCustomers || settings.allow_customers === true;

  // If the caller explicitly opted in (the modal's "Enroll customers anyway"
  // override), persist it on the sequence. The send-time cron guard in
  // process-emails only sees the sequence — not this runtime param — so without
  // this the queued email would be cancelled at send time even though we
  // deliberately enrolled the customer.
  if (allowCustomers && settings.allow_customers !== true) {
    await supabase
      .from("sequences")
      .update({ settings: { ...settings, allow_customers: true } })
      .eq("id", sequenceId)
      .eq("workspace_id", workspaceId);
  }

  // Pre-fetch eligible senders ONCE so we don't issue a getNextSender query per
  // contact. We round-robin through the result in JS — fast, deterministic
  // distribution within this batch. Falls back to per-row getNextSender if no
  // explicit senderAccountId override AND we somehow can't load the pool.
  let pooledSenders: Array<{ id: string }> = [];
  let senderIdx = 0;
  if (!senderAccountId) {
    const rotationPool = settings.rotation_account_ids;
    const hasPool = Array.isArray(rotationPool) && rotationPool.length > 0;

    let senderQuery = supabase
      .from("gmail_accounts")
      .select("id, daily_sends_count, max_daily_sends, status, workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("daily_sends_count", { ascending: true });
    if (hasPool) senderQuery = senderQuery.in("id", rotationPool);

    const { data: poolRows } = await senderQuery;
    pooledSenders = (poolRows || []).filter(
      (a) => (a.max_daily_sends ?? 0) - (a.daily_sends_count ?? 0) > 0
    );

    if (pooledSenders.length === 0) {
      // No pool capacity — fall through to per-row getNextSender so the
      // existing skip-with-reason path still fires.
    }
  }

  // Pre-fetch all templates referenced by any step so we don't re-query inside
  // the per-contact loop. Typical sequence has 2-5 templates max.
  const templateIds = [
    ...new Set((steps || []).map((s) => s.template_id).filter((x): x is string => !!x)),
  ];
  const templateById = new Map<string, EmailTemplate>();
  if (templateIds.length > 0) {
    const { data: templates } = await supabase
      .from("email_templates")
      .select("id, subject, body_html")
      .in("id", templateIds);
    for (const t of templates || []) templateById.set(t.id, t);
  }

  // Pre-fetch variants for every step in this sequence. Batch picker maintains
  // an in-memory sends_count so 500 picks against the same step produce a
  // true round-robin (not 500 copies of the lowest-count variant).
  const variantsByStepId = await fetchVariantsByStepId(
    supabase,
    (steps || []).map((s) => s.id),
  );
  const variantPicker = createBatchVariantPicker(variantsByStepId);

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

    // Don't enroll existing wl-app users (they're customers, not prospects).
    // Also covers the case where a colleague at the same shop signed up
    // (company has wl_workshop_id set even if this contact doesn't).
    // Bypass with allowCustomers=true for deliberate follow-up sequences.
    if (!effectiveAllowCustomers && contact.wl_user_id) {
      result.skipped++;
      result.skippedCustomer++;
      result.reasons.push(`${contact.email}: Already a wl-app user`);
      continue;
    }
    if (!effectiveAllowCustomers && contact.companies?.wl_workshop_id) {
      result.skipped++;
      result.skippedCustomer++;
      result.reasons.push(
        `${contact.email}: Company already has a wl-app workshop`,
      );
      continue;
    }

    // Skip contacts who were already sequenced via a prior outreach tool
    // (e.g. lemlist-csv backfill). Bypass with allowAlreadySequenced=true.
    if (!allowAlreadySequenced && contact.tags) {
      const priorTag = contact.tags.find((t) =>
        (ALREADY_SEQUENCED_TAGS as readonly string[]).includes(t)
      );
      if (priorTag) {
        result.skipped++;
        result.skippedAlreadySequenced++;
        result.reasons.push(`${contact.email}: Already contacted via prior tool (tag: ${priorTag})`);
        continue;
      }
    }

    // Determine sender. Use the pre-fetched pool (round-robin in JS), falling
    // back to the per-row getNextSender path if the pool is empty (so the
    // existing "no senders" skip reason still surfaces).
    let assignedSenderId = senderAccountId;
    if (!assignedSenderId) {
      if (pooledSenders.length > 0) {
        assignedSenderId = pooledSenders[senderIdx % pooledSenders.length].id;
        senderIdx++;
      } else {
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
    }

    // Resolve the contact's language ONCE, here, and pin it on the enrollment.
    // Recomputing it per step would let the hourly propagator rewrite
    // contacts.language mid-campaign and send email 1 in English, email 2 in
    // Polish, to the same person.
    const contactLanguage = resolveContactLanguage(contact, settings);
    const languageCtx = {
      language: contactLanguage,
      defaultLanguage: defaultLanguage(settings),
    };

    // Create enrollment — pin the sender so all steps use the same account
    const { data: enrollment, error: enrollError } = await supabase
      .from("sequence_enrollments")
      .insert({
        sequence_id: sequenceId,
        contact_id: contact.id,
        sender_account_id: assignedSenderId,
        status: "active",
        current_step: 0,
        language: contactLanguage,
      })
      .select()
      .single();

    if (enrollError) {
      result.skipped++;
      result.reasons.push(`${contact.email}: ${enrollError.message}`);
      continue;
    }

    // Resolve the opening of the sequence: the first email to queue, plus any
    // follow-up call / task steps that come before it.
    // For draft/paused sequences, queue as "pending" — emails won't send until sequence is activated
    const emailStatus = (["draft", "paused"].includes(sequence.status ?? "") ? "pending" : "scheduled") as "scheduled" | "pending";

    if (enrollment) {
      const walk = walkFromStep(steps ?? [], 0);
      const company = (contact as Record<string, unknown>).companies as never;

      if (walk.currentStep !== 0 || walk.completed) {
        await supabase
          .from("sequence_enrollments")
          .update(
            walk.completed
              ? {
                  current_step: walk.currentStep,
                  status: "completed",
                  completed_at: new Date().toISOString(),
                }
              : { current_step: walk.currentStep },
          )
          .eq("id", enrollment.id);
      }

      if (walk.emailStep) {
        const emailStep = walk.emailStep;
        const scheduledFor = calculateStepScheduleTime(
          settings,
          walk.delayDays,
          walk.delayHours,
        );

        const template = emailStep.template_id
          ? templateById.get(emailStep.template_id) ?? null
          : null;
        const picked = variantPicker.pickForStep(emailStep, template, languageCtx);
        let subject = picked.subject;
        let bodyHtml = picked.bodyHtml;

        const trackingId = crypto.randomUUID();

        // Resolve variables
        subject = resolveVariables(subject, contact, company, trackingId);
        bodyHtml = resolveVariables(bodyHtml, contact, company, trackingId);
        bodyHtml = ensureUnsubscribeLink(bodyHtml, trackingId);

        const { error: queueError } = await supabase.from("email_queue").insert({
          workspace_id: workspaceId,
          enrollment_id: enrollment.id,
          step_id: emailStep.id,
          contact_id: contact.id,
          sender_account_id: assignedSenderId,
          to_email: contact.email,
          subject,
          body_html: bodyHtml,
          status: emailStatus,
          scheduled_for: scheduledFor.toISOString(),
          tracking_id: trackingId,
          variant_id: picked.variantId,
        });
        if (queueError) {
          // Bail before creating any task, so a rolled-back enrollment can't
          // leave an orphaned call in someone's queue.
          await supabase.from("sequence_enrollments").delete().eq("id", enrollment.id);
          result.skipped++;
          result.reasons.push(`${contact.email}: Failed to queue first email — ${queueError.message}`);
          continue;
        }
      }

      if (walk.taskSteps.length > 0) {
        const { error: taskError } = await createStepTasks(supabase, {
          taskSteps: walk.taskSteps,
          workspaceId,
          enrollmentId: enrollment.id,
          contact,
          company,
        });
        if (taskError) {
          result.reasons.push(
            `${contact.email}: enrolled, but failed to create sequence task — ${taskError}`,
          );
        }
      }
    }

    result.enrolled++;
    enrolledContactIds.add(contact.id);
  }

  // Persist accumulated variant sends_count deltas (one RPC per variant used).
  await flushSendCountDeltas(supabase, variantPicker.deltas);

  return result;
}
