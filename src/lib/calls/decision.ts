// Pure decision logic for phone-call follow-up. Mirrors
// routes/visits-decision.ts so calls and field visits share one mental
// model. Kept import-free of Supabase so it's vitest-friendly without
// path-alias config.

export type CallOutcome =
  | "interested"
  | "not_interested"
  | "closed"
  | "no_answer"
  | "left_voicemail"
  | "callback_scheduled"
  | "wrong_number";

export const CALL_OUTCOMES: readonly CallOutcome[] = [
  "interested",
  "not_interested",
  "closed",
  "no_answer",
  "left_voicemail",
  "callback_scheduled",
  "wrong_number",
] as const;

// Did we reach a human? Used to default lead_status transitions when the
// caller doesn't pass `connected` explicitly.
export const CONNECTED_BY_DEFAULT: Record<CallOutcome, boolean> = {
  interested: true,
  not_interested: true,
  closed: true,
  no_answer: false,
  left_voicemail: false,
  callback_scheduled: true,
  wrong_number: false,
};

export const FOLLOW_UP_REQUIRED_DEFAULT: Record<CallOutcome, boolean> = {
  interested: true,
  not_interested: false,
  closed: false,
  no_answer: true,
  left_voicemail: true,
  callback_scheduled: true,
  wrong_number: false,
};

// Whether a successful call auto-enrolls the contact into a follow-up
// sequence (when the workspace has one configured for the outcome).
// callback_scheduled is handled by a task instead, so it stays false.
export const AUTO_ENROLL_DEFAULT: Record<CallOutcome, boolean> = {
  interested: true,
  not_interested: false,
  closed: false,
  no_answer: true,
  left_voicemail: true,
  callback_scheduled: false,
  wrong_number: false,
};

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  closed: "Closed (signed up)",
  no_answer: "No answer",
  left_voicemail: "Left voicemail",
  callback_scheduled: "Callback scheduled",
  wrong_number: "Wrong number",
};

export interface CallSettings {
  auto_followup_enabled?: boolean;
  sequence_by_outcome?: Partial<Record<CallOutcome, string>>;
  // In-CRM dialer (46elks bridge). When agent_phone is unset, click-to-call is
  // disabled and the UI prompts the user to configure it.
  /** The agent's own phone 46elks rings first, E.164 (e.g. +46701234567). */
  agent_phone?: string;
  /** Caller ID shown to the contact; a 46elks number. Falls back to env default. */
  caller_id?: string;
  /** Master switch for click-to-call + AI summarization (default on). */
  calling_enabled?: boolean;
}

export function readCallSettings(workspaceSettings: unknown): CallSettings {
  if (!workspaceSettings || typeof workspaceSettings !== "object") return {};
  const c = (workspaceSettings as Record<string, unknown>).calls;
  if (!c || typeof c !== "object") return {};
  return c as CallSettings;
}

export type EnrollmentSkipReason =
  | "outcome_default"
  | "explicit_override"
  | "no_contact"
  | "contact_unsubscribed"
  | "workspace_disabled"
  | "no_sequence_configured"
  | "enroll_failed";

export interface DecisionContext {
  outcome: CallOutcome;
  enrollOverride?: boolean;
  contactActive: boolean;
  workspaceAutoEnabled: boolean;
  sequenceId: string | null;
}

export function decideEnrollment(
  ctx: DecisionContext,
):
  | { enroll: false; reason: EnrollmentSkipReason }
  | { enroll: true; sequenceId: string } {
  if (ctx.enrollOverride === false) return { enroll: false, reason: "explicit_override" };

  const wantsEnroll = ctx.enrollOverride ?? AUTO_ENROLL_DEFAULT[ctx.outcome];
  if (!wantsEnroll) return { enroll: false, reason: "outcome_default" };

  if (!ctx.contactActive) return { enroll: false, reason: "contact_unsubscribed" };
  if (!ctx.workspaceAutoEnabled) return { enroll: false, reason: "workspace_disabled" };
  if (!ctx.sequenceId) return { enroll: false, reason: "no_sequence_configured" };

  return { enroll: true, sequenceId: ctx.sequenceId };
}

// lead_status transition on a call. Never downgrades; only advances a
// prospect along new -> contacted -> qualified -> customer.
const LEAD_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  customer: 3,
  churned: 3,
};

export function nextLeadStatus(
  current: string | null,
  outcome: CallOutcome,
  connected: boolean,
): string | null {
  const cur = current ?? "new";
  const curRank = LEAD_RANK[cur] ?? 0;

  let target: string | null = null;
  if (outcome === "closed") target = "customer";
  else if (outcome === "interested") target = "qualified";
  else if (connected) target = "contacted";

  if (!target) return null;
  const targetRank = LEAD_RANK[target] ?? 0;
  return targetRank > curRank ? target : null;
}
