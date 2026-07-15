import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { insertActivities, type ActivityRow } from "@/lib/activities/insert";

type Supabase = SupabaseClient<Database>;

/**
 * Stop a sequence enrollment because the contact (or a co-worker at their
 * company) replied.
 *
 * This is the single source of truth for reply-driven cancellation. It is
 * called from BOTH the `check-replies` cron and the `mailbox-sync` cron —
 * whichever ingests the reply first. Historically only `check-replies`
 * carried this logic, so a reply first logged by `mailbox-sync` (which runs on
 * an offset schedule and often wins the race) escaped cancellation entirely
 * and the next follow-up still went out. Keeping the logic here means neither
 * cron can drift from the other.
 *
 * Idempotent: it only acts on an `active` enrollment, so calling it twice (or
 * after the enrollment already moved to `replied`/`completed`) is a no-op.
 */
export async function applyStopOnReply(
  supabase: Supabase,
  params: { enrollmentId: string; workspaceId: string },
): Promise<{ stopped: boolean }> {
  const { enrollmentId, workspaceId } = params;

  const { data: enrollment } = await supabase
    .from("sequence_enrollments")
    .select("*, sequences(*), contacts(id, company_id, first_name, last_name)")
    .eq("id", enrollmentId)
    .eq("status", "active")
    .maybeSingle();

  if (!enrollment) return { stopped: false };

  const sequence = enrollment.sequences as unknown as {
    id: string;
    name: string;
    settings: { stop_on_reply?: boolean; stop_on_company_reply?: boolean };
  };

  if (!sequence?.settings?.stop_on_reply) return { stopped: false };

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
    const seqName = sequence?.name ?? "sequence";
    const contactName = enrollmentContact
      ? [enrollmentContact.first_name, enrollmentContact.last_name].filter(Boolean).join(" ") || "contact"
      : "contact";
    if (enrollmentContact?.id) {
      await supabase.from("tasks").insert({
        workspace_id: workspaceId,
        contact_id: enrollmentContact.id,
        enrollment_id: enrollment.id,
        type: "email",
        title: `Follow up with ${contactName || "contact"} — replied to "${seqName}"`,
        description: "They replied to your sequence. Review their reply in Inbox and respond.",
        due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priority: "high",
      });
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
      .eq("workspace_id", workspaceId)
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
        const activityInserts: ActivityRow[] = otherEnrollments.map((e) => ({
          workspace_id: workspaceId,
          type: "sequence_paused",
          subject: "Sequence paused — company reply",
          body: `Sequence paused — reply received from another contact at ${companyName}`,
          contact_id: e.contact_id,
          metadata: {
            reason: "company_reply",
            company_id: companyId,
            replying_enrollment_id: enrollment.id,
          },
        }));
        await insertActivities(supabase, activityInserts, {
          context: "stop-on-reply/company-paused",
        });
      }
    }
  }

  return { stopped: true };
}
