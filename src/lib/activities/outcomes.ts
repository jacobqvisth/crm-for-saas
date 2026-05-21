// Canonical "interaction outcome" enum shared across field visits, logged
// calls, and any other activity row that captures a sales-style outcome.
// Field visits originated this taxonomy (see `src/lib/routes/visits-decision.ts`);
// it is now generalized so call/email/visit activities all speak the same
// language and a future PR can wire per-outcome sequence auto-enroll for
// every channel, not just visits.

export type ActivityOutcome =
  | "interested"
  | "closed"
  | "no_answer"
  | "not_interested"
  | "skipped";

export const ACTIVITY_OUTCOMES: readonly ActivityOutcome[] = [
  "interested",
  "closed",
  "no_answer",
  "not_interested",
  "skipped",
] as const;

export const OUTCOME_LABEL: Record<ActivityOutcome, string> = {
  interested: "Interested",
  closed: "Closed (signed up)",
  no_answer: "No answer",
  not_interested: "Not interested",
  skipped: "Skipped",
};

export interface OutcomeOption {
  value: ActivityOutcome;
  label: string;
  helper: string;
}

export const OUTCOME_OPTIONS: OutcomeOption[] = [
  { value: "interested",     label: "Interested",     helper: "Wants more info / will sign up" },
  { value: "closed",         label: "Closed",         helper: "Signed up on the spot" },
  { value: "no_answer",      label: "No answer",      helper: "Nobody reached / closed for the day" },
  { value: "not_interested", label: "Not interested", helper: "Explicit no — marks the company Do Not Contact" },
  { value: "skipped",        label: "Skipped",        helper: "Did not engage / not relevant" },
];

export const OUTCOME_BADGE_COLORS: Record<ActivityOutcome, string> = {
  interested:     "bg-emerald-100 text-emerald-700",
  closed:         "bg-indigo-100 text-indigo-700",
  no_answer:      "bg-amber-100 text-amber-700",
  not_interested: "bg-red-100 text-red-700",
  skipped:        "bg-slate-100 text-slate-600",
};

export function isActivityOutcome(value: unknown): value is ActivityOutcome {
  return typeof value === "string" && (ACTIVITY_OUTCOMES as readonly string[]).includes(value);
}
