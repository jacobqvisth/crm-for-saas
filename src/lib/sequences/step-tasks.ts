import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveVariables } from "./variables";
import type { ScheduledTaskStep } from "./step-walk";
import type { Database, Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

/** The step columns a call/task step needs to build its task. */
export interface TaskStepFields {
  id: string;
  step_order: number;
  type: string | null;
  task_title: string | null;
  task_description: string | null;
  task_priority: string | null;
  task_due_days: number | null;
}

interface CreateStepTasksParams {
  taskSteps: ScheduledTaskStep<TaskStepFields & { delay_days: number | null; delay_hours: number | null }>[];
  workspaceId: string;
  enrollmentId: string;
  contact: Contact;
  company?: Company | null;
  /** Instant the walk started from — offsets are measured off this. */
  baseDate?: Date;
}

function defaultTitle(step: TaskStepFields, contact: Contact, company?: Company | null): string {
  const who =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    company?.name ||
    contact.email;
  return step.type === "call" ? `Follow-up call: ${who}` : `Follow up with ${who}`;
}

/**
 * Creates the `tasks` rows for the call/task steps a sequence walk passed over.
 *
 * Silently skips duplicates: the (enrollment_id, sequence_step_id) unique index
 * means a step that fires twice for one enrollment — a retried cron run, say —
 * does not produce two identical tasks in the rep's queue.
 */
export async function createStepTasks(
  supabase: SupabaseClient<Database>,
  params: CreateStepTasksParams,
): Promise<{ created: number; error: string | null }> {
  const { taskSteps, workspaceId, enrollmentId, contact, company, baseDate } = params;
  if (taskSteps.length === 0) return { created: 0, error: null };

  const base = (baseDate ?? new Date()).getTime();

  const rows = taskSteps.map(({ step, offsetMs }) => {
    const dueMs =
      base + offsetMs + (step.task_due_days || 0) * 24 * 60 * 60 * 1000;
    const rawTitle = step.task_title?.trim() || defaultTitle(step, contact, company);
    return {
      workspace_id: workspaceId,
      enrollment_id: enrollmentId,
      sequence_step_id: step.id,
      contact_id: contact.id,
      company_id: contact.company_id,
      // A "call" step lands in the rep's call queue; a "task" step is generic.
      type: step.type === "call" ? "call" : "generic",
      title: resolveVariables(rawTitle, contact, company),
      description: step.task_description
        ? resolveVariables(step.task_description, contact, company)
        : null,
      priority: step.task_priority || "medium",
      due_date: new Date(dueMs).toISOString(),
    };
  });

  const { data, error } = await supabase
    .from("tasks")
    .upsert(rows, {
      onConflict: "enrollment_id,sequence_step_id",
      ignoreDuplicates: true,
    })
    .select("id");

  // A failed task insert must never take the email send down with it — the
  // caller has already sent the message by the time we get here — so the error
  // comes back for the caller to log rather than throwing.
  return { created: data?.length ?? 0, error: error?.message ?? null };
}
