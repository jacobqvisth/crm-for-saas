// Pure decision logic for field-visit follow-up.
// Kept import-free of Supabase / promote / enroll so it's vitest-friendly
// without path-alias configuration.

export type VisitOutcome =
  | "interested"
  | "not_interested"
  | "closed"
  | "no_answer"
  | "skipped";

export const VISIT_OUTCOMES: readonly VisitOutcome[] = [
  "interested",
  "not_interested",
  "closed",
  "no_answer",
  "skipped",
] as const;

export const FOLLOW_UP_REQUIRED_DEFAULT: Record<VisitOutcome, boolean> = {
  interested: true,
  not_interested: false,
  closed: false,
  no_answer: true,
  skipped: false,
};

export const AUTO_ENROLL_DEFAULT: Record<VisitOutcome, boolean> = {
  interested: true,
  not_interested: false,
  closed: false,
  no_answer: true,
  skipped: false,
};

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  closed: "Closed (signed up)",
  no_answer: "No answer",
  skipped: "Skipped",
};

export interface FieldVisitsSettings {
  auto_followup_enabled?: boolean;
  sequence_by_outcome?: Partial<Record<VisitOutcome, string>>;
}

export function readFieldVisitsSettings(workspaceSettings: unknown): FieldVisitsSettings {
  if (!workspaceSettings || typeof workspaceSettings !== "object") return {};
  const fv = (workspaceSettings as Record<string, unknown>).field_visits;
  if (!fv || typeof fv !== "object") return {};
  return fv as FieldVisitsSettings;
}

export type EnrollmentSkipReason =
  | "outcome_default"
  | "explicit_override"
  | "no_company"
  | "company_skip_auto_followup"
  | "workspace_disabled"
  | "no_sequence_configured"
  | "no_contact"
  | "enroll_failed";

export interface DecisionContext {
  outcome: VisitOutcome;
  enrollOverride?: boolean;
  companyId: string | null;
  companySkipAutoFollowup: boolean;
  workspaceAutoEnabled: boolean;
  sequenceId: string | null;
}

export function decideEnrollment(
  ctx: DecisionContext,
): { enroll: false; reason: EnrollmentSkipReason } | { enroll: true; sequenceId: string } {
  if (ctx.enrollOverride === false) return { enroll: false, reason: "explicit_override" };

  const outcomeDefault = AUTO_ENROLL_DEFAULT[ctx.outcome];
  const wantsEnroll = ctx.enrollOverride ?? outcomeDefault;
  if (!wantsEnroll) return { enroll: false, reason: "outcome_default" };

  if (!ctx.companyId) return { enroll: false, reason: "no_company" };
  if (ctx.companySkipAutoFollowup) return { enroll: false, reason: "company_skip_auto_followup" };
  if (!ctx.workspaceAutoEnabled) return { enroll: false, reason: "workspace_disabled" };
  if (!ctx.sequenceId) return { enroll: false, reason: "no_sequence_configured" };

  return { enroll: true, sequenceId: ctx.sequenceId };
}
