import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@/lib/database.types";
import { insertActivity } from "@/lib/activities/insert";
import { enrollContacts } from "@/lib/sequences/enrollment";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABEL,
  CONNECTED_BY_DEFAULT,
  FOLLOW_UP_REQUIRED_DEFAULT,
  decideEnrollment,
  nextLeadStatus,
  readCallSettings,
  type CallOutcome,
  type EnrollmentSkipReason,
} from "./decision";

export {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABEL,
  FOLLOW_UP_REQUIRED_DEFAULT,
  decideEnrollment,
  readCallSettings,
};
export type { CallOutcome, EnrollmentSkipReason };

type Client = SupabaseClient<Database>;

export interface CallFeedbackInput {
  category: "bug" | "feature_request" | "complaint" | "praise" | "other";
  severity?: "low" | "medium" | "high" | "critical" | null;
  title?: string | null;
  body: string;
}

export interface LogCallParams {
  contactId: string;
  /** Falls back to the contact's company_id when omitted. */
  companyId?: string | null;
  /** Optional source list, recorded on the activity for session attribution. */
  listId?: string | null;
  outcome: CallOutcome;
  /** Did we reach a human? Defaults from the outcome when omitted. */
  connected?: boolean;
  notes?: string | null;
  durationSeconds?: number | null;
  /** ISO datetime — required-ish when outcome is callback_scheduled. */
  callbackAt?: string | null;
  /** When the call happened; defaults to now. */
  occurredAt?: string;
  enrollOverride?: boolean;
  followUpRequiredOverride?: boolean;
  /** Product feedback captured during the call (existing-user calls). */
  feedback?: CallFeedbackInput[];
  userId: string;
  supabase: Client;
}

export interface LogCallResult {
  activityId: string;
  contactId: string;
  companyId: string | null;
  connected: boolean;
  leadStatus?: string;
  taskId?: string;
  feedbackIds: string[];
  feedbackError?: string;
  enrollmentId?: string;
  enrollmentSkipReason?: EnrollmentSkipReason;
  enrollmentSkipDetail?: string;
}

export async function logCall(params: LogCallParams): Promise<LogCallResult> {
  const {
    contactId,
    outcome,
    notes,
    durationSeconds,
    callbackAt,
    occurredAt,
    enrollOverride,
    feedback,
    userId,
    supabase,
  } = params;

  if (!CALL_OUTCOMES.includes(outcome)) {
    throw new Error(`logCall: invalid outcome '${outcome}'`);
  }

  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .select("id, workspace_id, company_id, first_name, last_name, lead_status, status")
    .eq("id", contactId)
    .maybeSingle();

  if (contactErr) throw new Error(`logCall: load contact: ${contactErr.message}`);
  if (!contact) throw new Error(`logCall: contact ${contactId} not found`);

  const workspaceId = contact.workspace_id;
  const effectiveCompanyId = params.companyId ?? contact.company_id ?? null;
  const connected = params.connected ?? CONNECTED_BY_DEFAULT[outcome];
  const occurred_at = occurredAt ?? new Date().toISOString();
  const contactName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || "contact";

  const metadata: Record<string, Json> = {
    outcome,
    connected,
    direction: "outbound",
  };
  if (params.listId) metadata.listId = params.listId;
  if (typeof durationSeconds === "number") metadata.duration_seconds = durationSeconds;
  if (outcome === "callback_scheduled" && callbackAt) metadata.callback_at = callbackAt;

  // 1) The call activity — single source of truth for the timeline. Hard-fails.
  const { id: activityId } = await insertActivity(
    supabase,
    {
      workspace_id: workspaceId,
      type: "call",
      outcome,
      subject: `Call: ${CALL_OUTCOME_LABEL[outcome]} — ${contactName}`,
      body: notes ?? null,
      contact_id: contactId,
      company_id: effectiveCompanyId,
      user_id: userId,
      metadata,
      created_at: occurred_at,
    },
    { context: "logCall" },
  );

  // 2) Recency + lifecycle on the contact.
  const lead_status = nextLeadStatus(contact.lead_status, outcome, connected);
  const contactUpdate: Record<string, unknown> = { last_contacted_at: occurred_at };
  if (lead_status) contactUpdate.lead_status = lead_status;
  const { error: cuErr } = await supabase
    .from("contacts")
    .update(contactUpdate)
    .eq("id", contactId);
  if (cuErr) throw new Error(`logCall: update contact: ${cuErr.message}`);

  // 3) Not interested → company-level DNC (mirrors field visits).
  if (outcome === "not_interested" && effectiveCompanyId) {
    const { error: dncErr } = await supabase
      .from("companies")
      .update({ do_not_contact: true })
      .eq("id", effectiveCompanyId)
      .eq("workspace_id", workspaceId);
    if (dncErr) throw new Error(`logCall: set do_not_contact: ${dncErr.message}`);
  }

  // 4) Callback → a real follow-up task on the assignee's task list.
  let taskId: string | undefined;
  if (outcome === "callback_scheduled") {
    const taskRow: TablesInsert<"tasks"> = {
      workspace_id: workspaceId,
      type: "call",
      title: `Callback: ${contactName}`,
      contact_id: contactId,
      company_id: effectiveCompanyId,
      due_date: callbackAt ?? null,
      priority: "medium",
      created_by: userId,
    };
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .insert(taskRow)
      .select("id")
      .single();
    if (taskErr) throw new Error(`logCall: create callback task: ${taskErr.message}`);
    taskId = task?.id;
  }

  // 5) Product feedback (existing-user calls). Soft-fail: the call is
  // already recorded, so a feedback insert error must not orphan it.
  const feedbackIds: string[] = [];
  let feedbackError: string | undefined;
  if (feedback && feedback.length > 0) {
    const rows: TablesInsert<"call_feedback">[] = feedback.map((f) => ({
      workspace_id: workspaceId,
      activity_id: activityId,
      contact_id: contactId,
      company_id: effectiveCompanyId,
      user_id: userId,
      category: f.category,
      severity: f.severity ?? null,
      title: f.title ?? null,
      body: f.body,
    }));
    const { data: fbData, error: fbErr } = await supabase
      .from("call_feedback")
      .insert(rows)
      .select("id");
    if (fbErr) feedbackError = fbErr.message;
    else feedbackIds.push(...fbData.map((r) => r.id));
  }

  const base: LogCallResult = {
    activityId,
    contactId,
    companyId: effectiveCompanyId,
    connected,
    leadStatus: lead_status ?? undefined,
    taskId,
    feedbackIds,
    feedbackError,
  };

  // 6) Auto-enroll into a follow-up sequence when configured for the outcome.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .maybeSingle();
  const cs = readCallSettings(workspace?.settings);
  const workspaceAutoEnabled = cs.auto_followup_enabled !== false;
  const sequenceId = cs.sequence_by_outcome?.[outcome] ?? null;

  const decision = decideEnrollment({
    outcome,
    enrollOverride,
    contactActive: contact.status !== "unsubscribed" && contact.status !== "bounced",
    workspaceAutoEnabled,
    sequenceId,
  });

  if (!decision.enroll) {
    return { ...base, enrollmentSkipReason: decision.reason };
  }

  const enrollResult = await enrollContacts({
    sequenceId: decision.sequenceId,
    contactIds: [contactId],
    workspaceId,
    // A logged call is a deliberate touch — build on it rather than being
    // blocked by the prior-outreach guard (same rationale as field visits).
    allowAlreadySequenced: true,
  });

  if (enrollResult.enrolled === 0) {
    return {
      ...base,
      enrollmentSkipReason: "enroll_failed",
      enrollmentSkipDetail: enrollResult.reasons[0] ?? "unknown",
    };
  }

  const { data: enrollmentRow } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", decision.sequenceId)
    .eq("contact_id", contactId)
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { ...base, enrollmentId: enrollmentRow?.id };
}
