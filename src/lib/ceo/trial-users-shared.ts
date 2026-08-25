// Shared types for the /dashboard/trial-users page. Kept free of server
// imports so the client content component can import them (same split as
// promo-users-shared.ts / free-users-shared.ts).

export type TrialTab =
  | "overview"
  | "conversion"
  | "live"
  | "users"
  | "timeline"
  | "outreach"
  | "product"
  | "cohorts";

export const TRIAL_TABS: ReadonlyArray<{ key: TrialTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "conversion", label: "What converts" },
  { key: "live", label: "Live trials" },
  { key: "users", label: "Users" },
  { key: "timeline", label: "Timeline" },
  { key: "outreach", label: "Outreach" },
  { key: "product", label: "Product use" },
  { key: "cohorts", label: "Cohorts" },
];

/** Structurally matches ceo/source-info-data's SourceInfo so InfoHint takes it. */
export type TrialInfo = {
  title: string;
  body: string;
  sources?: string[];
  logic?: string;
};

/**
 * What happened to one trial. Deliberately finer than "converted / did not":
 * a trial that was cancelled on day three is a different failure from one that
 * ran its full length and lapsed, and a card that declined at the end is not a
 * decision at all. These are mutually exclusive and DO sum to the trial total.
 */
export type TrialOutcome =
  | "live"
  | "converted_active"
  | "converted_past_due"
  | "converted_churned"
  | "canceled_during_trial"
  | "expired_unpaid"
  | "payment_failed"
  | "active_never_charged"
  | "paused";

export const OUTCOME_LABELS: Record<TrialOutcome, string> = {
  live: "Still running",
  converted_active: "Converted, still paying",
  converted_past_due: "Converted, now past due",
  converted_churned: "Converted, then cancelled",
  canceled_during_trial: "Cancelled during the trial",
  expired_unpaid: "Ran out, never charged",
  payment_failed: "Trial ended, payment failed",
  active_never_charged: "Active but never charged",
  paused: "Paused",
};

export const OUTCOME_DESCRIPTIONS: Record<TrialOutcome, string> = {
  live: "The trial window has not closed yet, so its outcome is unknown. These are excluded from every conversion denominator on this page.",
  converted_active:
    "Money moved at least once and the subscription is still active. This is the outcome the trial exists to produce.",
  converted_past_due:
    "Paid at least once, but a later payment is failing. Still a converted trial, and a live dunning problem.",
  converted_churned:
    "Paid at least once and then cancelled. Counted as a conversion, because the trial did its job before the product or the price did not.",
  canceled_during_trial:
    "Cancelled before the trial window closed: an explicit decision not to buy, made while still trying it.",
  expired_unpaid:
    "The trial window closed and no invoice was ever paid. The bulk of trials land here.",
  payment_failed:
    "The trial ended and the card was declined, so the subscription went past due without ever being charged. Not a decision — a payment problem.",
  active_never_charged:
    "The subscription is active but no money has ever moved, which is what a full comp or a 100% coupon looks like.",
  paused: "The subscription is paused, never charged.",
};

/** Outcomes that mean money moved at least once. */
export const CONVERTED_OUTCOMES: ReadonlySet<TrialOutcome> = new Set<TrialOutcome>([
  "converted_active",
  "converted_past_due",
  "converted_churned",
]);

export type CohortKey =
  | "trial_converted"
  | "trial_expired"
  | "trial_live"
  | "never_trialed";

export const COHORT_LABELS: Record<CohortKey, string> = {
  trial_converted: "Trialed and paid",
  trial_expired: "Trialed, never paid",
  trial_live: "Trial running now",
  never_trialed: "Never trialed",
};

/** Column order for the comparison table, widest denominator last. */
export const COHORT_ORDER: ReadonlyArray<CohortKey> = [
  "trial_converted",
  "trial_expired",
  "trial_live",
  "never_trialed",
];

export type CohortStats = {
  key: CohortKey;
  label: string;
  users: number;
  workshops: number;
  totalDiagnostics: number;
  avgDiagnostics: number;
  medianDiagnostics: number;
  maxDiagnostics: number;
  pctActivated: number;
  pctRepeat: number;
  pctPower: number;
  avgActiveDays: number;
  pctActive30d: number;
  pctEverPaid: number;
  avgChats: number;
  avgFeatureEvents: number;
  avgLogins: number;
  avgDiagnosticsDuringTrial: number;
  pctUsedDuringTrial: number;
  diagnosticsPerActiveDay: number;
  stageLoggedIn: number;
  stageActivated: number;
  stageUsedInTrial: number;
  stageRepeat: number;
  stageHabit: number;
  stagePaid: number;
  stageActive30d: number;
};

/**
 * How a trial's start date was established. Stripe knows it exactly, but the
 * warehouse only began storing it with the sync change that shipped alongside
 * this page — until that sync has run, every historical row falls back.
 */
export type TrialStartSource = "stripe" | "customer" | "assumed";

export const TRIAL_START_SOURCE_LABELS: Record<TrialStartSource, string> = {
  stripe: "Exact (Stripe trial_start)",
  customer: "Inferred from the Stripe customer date",
  assumed: "Assumed 14 days before the trial ended",
};

/** One trial. The unit of CONVERSION. */
export type TrialRow = {
  subscriptionId: string;
  workshopId: string | null;
  customerId: string | null;
  email: string | null;
  workshop: string | null;
  country: string | null;
  isInternal: boolean;
  isPartner: boolean;

  status: string | null;
  outcome: TrialOutcome;
  /** Raw plan_key: a Stripe price id on historical rows, a plan name on newer. */
  rawPlanKey: string | null;
  planKey: string | null;
  planLabel: string;
  tier: string | null;
  interval: string | null;
  /** True when the price id is not in the hand-maintained map. */
  planUnmapped: boolean;

  currency: string | null;
  mrrCents: number;

  trialStart: string | null;
  trialStartSource: TrialStartSource;
  trialEnd: string | null;
  trialLengthDays: number;
  daysLeft: number | null;

  everPaid: boolean;
  firstPaidAt: string | null;
  daysToPay: number | null;
  canceledAt: string | null;
  hasPromo: boolean;
  extensionReason: string | null;

  /** Rolled up from the app users at this trial's workshop. */
  users: number;
  diagnosticsDuringTrial: number;
  diagnosticsTotal: number;
  activeDaysDuringTrial: number;
  callsDuringTrial: number;
  emailsDuringTrial: number;
  contacted: boolean;
};

/** One app user inside a trial workshop. The unit of BEHAVIOUR. */
export type TrialUserRow = {
  userId: string;
  email: string | null;
  workshopId: string | null;
  workshop: string | null;
  country: string | null;
  contactId: string | null;
  isInternal: boolean;

  trialCount: number;
  trialStart: string | null;
  trialStartSource: TrialStartSource;
  trialEnd: string | null;
  trialLengthDays: number;
  trialStatus: string | null;
  outcome: TrialOutcome;
  planLabel: string;
  tier: string | null;
  currency: string | null;
  mrrCents: number;
  everPaid: boolean;
  firstPaidAt: string | null;
  hasPromo: boolean;
  signedUpAt: string | null;
  churnedAt: string | null;

  diagnostics: number;
  diagnosticsFirstAt: string | null;
  diagnosticsLastAt: string | null;
  diagnostics30d: number;
  diagnosticsBeforeTrial: number;
  diagnosticsDuringTrial: number;
  diagnosticsAfterTrial: number;
  daysToFirstDiagnosis: number | null;
  chats: number;
  featureEvents: number;
  logins: number;
  activeDays: number;
  activeDaysDuringTrial: number;
  lastActiveAt: string | null;

  calls: number;
  callsConnected: number;
  callsDuringTrial: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  emailsSent: number;
  emailsDuringTrial: number;
  firstEmailAt: string | null;
  lastEmailAt: string | null;
  opens: number;
  clicks: number;
  replies: number;
  activities: number;
};

/**
 * One row of a conversion cut. `concluded` is the denominator, deliberately
 * separate from `trials`: a live trial has no outcome yet, and folding it into
 * the denominator silently understates conversion for any recent slice.
 */
export type ConversionCutRow = {
  key: string;
  label: string;
  trials: number;
  live: number;
  concluded: number;
  converted: number;
  pct: number | null;
  detail?: string | null;
};

export type ConversionCut = {
  key: string;
  label: string;
  description: string;
  rows: ConversionCutRow[];
  /** Rendered under the table when the cut needs a warning of its own. */
  caveat?: string;
};

export type OutcomeBucket = {
  key: TrialOutcome;
  label: string;
  description: string;
  trials: number;
  workshops: number;
};

export type LiveTrialRow = {
  subscriptionId: string;
  workshopId: string | null;
  workshop: string | null;
  email: string | null;
  country: string | null;
  planLabel: string;
  currency: string | null;
  mrrCents: number;
  trialStart: string | null;
  trialEnd: string | null;
  daysLeft: number;
  users: number;
  diagnosticsDuringTrial: number;
  diagnosticsTotal: number;
  activeDaysDuringTrial: number;
  lastActiveAt: string | null;
  calls: number;
  emailsSent: number;
  contacted: boolean;
  hasPromo: boolean;
  /** 0-100, higher = more likely to lapse. Explained in RISK_INFO. */
  risk: number;
  riskReasons: string[];
};

export type WeeklyPoint = {
  /** Chart components key on `date`. */
  date: string;
  started: number;
  ended: number;
  converted: number;
  diagnostics: number;
};

export type EventKind =
  | "signup"
  | "trial_start"
  | "trial_end"
  | "paid"
  | "canceled"
  | "call"
  | "email"
  | "reply"
  | "diagnosis";

export type TimelineEvent = {
  id: string;
  at: string;
  kind: EventKind;
  /** Who did it: rep name for a call, sending mailbox for an email. */
  actor: string | null;
  title: string;
  detail: string | null;
  outcome: string | null;
};

export type TimelineUser = {
  userId: string;
  email: string | null;
  workshop: string | null;
  outcome: TrialOutcome;
  trialStart: string | null;
  trialEnd: string | null;
  diagnostics: number;
  events: TimelineEvent[];
};

export type CallLogRow = {
  id: string;
  at: string | null;
  email: string | null;
  workshop: string | null;
  rep: string | null;
  direction: string | null;
  connected: boolean;
  durationSeconds: number | null;
  outcome: string | null;
  summary: string | null;
  /** Negative = before the trial opened. */
  daysFromTrialStart: number | null;
  /** Negative = before the trial closed, so "how late in the trial". */
  daysFromTrialEnd: number | null;
  duringTrial: boolean;
};

export type EmailLogRow = {
  id: string;
  at: string | null;
  email: string | null;
  workshop: string | null;
  sender: string | null;
  subject: string | null;
  sequence: string | null;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  daysFromTrialStart: number | null;
  daysFromTrialEnd: number | null;
  duringTrial: boolean;
};

export type FunnelStage = {
  key: string;
  label: string;
  description: string;
  counts: Record<CohortKey, number>;
  /** Share of that cohort's total, 0-100. */
  pct: Record<CohortKey, number>;
};

export type TermCount = {
  term: string;
  count: number;
  users: number;
};

export type MoneyTotal = {
  currency: string;
  /** Monthly recurring revenue from trials that converted and are still live. */
  activeMrrCents: number;
  /** MRR that was won and then lost. */
  churnedMrrCents: number;
  /** MRR riding on trials that have not closed yet. */
  liveTrialMrrCents: number;
  converted: number;
  live: number;
};

export type TrialUsersKpis = {
  trials: number;
  workshops: number;
  users: number;
  live: number;
  concluded: number;
  converted: number;
  conversionPct: number | null;
  stillPaying: number;
  churnedAfterPaying: number;
  usedDuringTrial: number;
  convertedWithoutUsing: number;
  neverContacted: number;
  medianDaysToFirstUse: number | null;
  medianTrialLength: number | null;
  unmatchedTrials: number;
  internalTrials: number;
  estimatedWindows: number;
  /**
   * Totals BEFORE the outreach tab's row cap. The logs render the most recent
   * slice, and a table that shows 400 of 3,000 rows without saying so reads as
   * "this is everything", so the page states both numbers.
   */
  totalCalls: number;
  totalEmails: number;
};

export type TrialUsersData = {
  kpis: TrialUsersKpis;
  money: MoneyTotal[];
  outcomes: OutcomeBucket[];
  cohorts: CohortStats[];
  cuts: ConversionCut[];
  trials: TrialRow[];
  users: TrialUserRow[];
  live: LiveTrialRow[];
  weekly: WeeklyPoint[];
  timeline: TimelineUser[];
  calls: CallLogRow[];
  emails: EmailLogRow[];
  funnel: FunnelStage[];
  searchTerms: TermCount[];
  carMakes: TermCount[];
  dtcs: TermCount[];
  symptoms: TermCount[];
  unmappedPlanKeys: string[];
  note: string;
  error: string | null;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function daysBetween(
  from: string | null,
  to: string | null,
): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Conversion is quoted against CONCLUDED trials only. A trial that is still
 * running has no outcome, and including it in the denominator would make every
 * recent period look worse than it is purely because it is recent.
 */
export function conversionPct(
  converted: number,
  concluded: number,
): number | null {
  if (concluded === 0) return null;
  return (converted / concluded) * 100;
}
