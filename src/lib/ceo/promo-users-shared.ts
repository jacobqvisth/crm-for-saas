// Shared types for the /dashboard/promo-users page. Kept free of server
// imports so the client content component can import them (same split as
// free-users-shared.ts / valdemar-shared.ts).

export type PromoTab =
  | "overview"
  | "evidence"
  | "users"
  | "timeline"
  | "outreach"
  | "product"
  | "funnel";

export const PROMO_TABS: ReadonlyArray<{ key: PromoTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "evidence", label: "Does it work" },
  { key: "users", label: "Users" },
  { key: "timeline", label: "Timeline" },
  { key: "outreach", label: "Outreach" },
  { key: "product", label: "Product use" },
  { key: "funnel", label: "Funnel" },
];

/** Structurally matches ceo/source-info-data's SourceInfo so InfoHint takes it. */
export type PromoInfo = {
  title: string;
  body: string;
  sources?: string[];
  logic?: string;
};

/**
 * Five cohorts, two of which are deliberate SUBSETS of the others, so these
 * must never be summed.
 *
 * The original design had a cohort called "paid_no_promo" defined as
 * `ever_paid OR trial_end IS NOT NULL OR plan_key <> 'free'`. That is "reached
 * checkout", NOT "paid": of its 125 users only 37 were ever charged, so the
 * table showed a column labelled "Paid, no promo" whose own "ever paid" cell
 * read 30%. This is the documented plan_key trial trap — plan_key and trial_end
 * are stamped at checkout, before any money moves.
 *
 * So `checkout_no_promo` is now named for what it is, and the genuinely
 * comparable pair `promo_charged` vs `charged_no_promo` (everyone charged on
 * both sides) carries the like-for-like read.
 */
export type CohortKey =
  | "promo"
  | "promo_charged"
  | "charged_no_promo"
  | "checkout_no_promo"
  | "free_no_promo";

export const COHORT_LABELS: Record<CohortKey, string> = {
  promo: "Got a promo",
  promo_charged: "Promo, charged",
  charged_no_promo: "Paid, no promo",
  checkout_no_promo: "Reached checkout, no promo",
  free_no_promo: "Free, never checked out",
};

/** Columns of the main comparison table, widest denominators last. */
export const MAIN_COHORTS: ReadonlyArray<CohortKey> = [
  "promo",
  "charged_no_promo",
  "checkout_no_promo",
  "free_no_promo",
];

/** The two cohorts that are apples-to-apples: everybody in them was charged. */
export const LIKE_FOR_LIKE: ReadonlyArray<CohortKey> = [
  "promo_charged",
  "charged_no_promo",
];

/** How the checkout cohort splits, so its sub-100% "ever paid" is explainable. */
export type CheckoutComposition = {
  charged: number;
  trialOnly: number;
  cardedNeverCharged: number;
};

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
  diagnosticsPerActiveDay: number;
};

/** One app user who received a promo, with everything we know about them. */
export type PromoUserRow = {
  userId: string;
  email: string | null;
  workshopId: string | null;
  workshop: string | null;
  country: string | null;
  contactId: string | null;

  code: string | null;
  couponId: string | null;
  percentOff: number | null;
  terms: string;
  appliedAt: string | null;
  lastAppliedAt: string | null;
  promoActive: boolean;
  /**
   * Discount attached to this user's WORKSHOP, shown for context only. Never
   * sum this across users: several techs at one workshop share a single grant,
   * so summing it multiplies the same money (it inflated the total from
   * 121,238 to 177,771 SEK before this was pinned down).
   */
  workshopDiscountCents: number;
  currency: string | null;

  planKey: string | null;
  subscriptionStatus: string | null;
  everPaid: boolean;
  trialEnd: string | null;
  signedUpAt: string | null;
  churnedAt: string | null;
  isInternal: boolean;

  diagnostics: number;
  diagnosticsFirstAt: string | null;
  diagnosticsLastAt: string | null;
  diagnostics30d: number;
  diagnosticsBefore: number;
  diagnosticsAfter: number;
  diagnosticsAfter30d: number;
  chats: number;
  featureEvents: number;
  logins: number;
  activeDays: number;
  lastActiveAt: string | null;

  calls: number;
  callsConnected: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  emailsSent: number;
  firstEmailAt: string | null;
  lastEmailAt: string | null;
  opens: number;
  clicks: number;
  replies: number;
  activities: number;
};

/** Grant-level row. The unit of MONEY, one per (stripe customer, coupon). */
export type PromoGrantRowView = {
  grantId: string;
  email: string | null;
  workshop: string | null;
  code: string | null;
  couponId: string;
  terms: string;
  active: boolean;
  subscriptionStatus: string | null;
  currency: string | null;
  discountedCents: number;
  paidCents: number;
  invoiceCount: number;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
  source: string;
};

export type PromoCodeRow = {
  key: string;
  code: string | null;
  couponId: string;
  terms: string;
  recipients: number;
  activeNow: number;
  everPaid: number;
  withDiagnostics: number;
  totalDiagnostics: number;
  avgDiagnostics: number;
  medianDaysToFirstUse: number | null;
  discountByCurrency: Array<{ currency: string; cents: number }>;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
};

export type PromoMoneyTotal = {
  currency: string;
  discountedCents: number;
  paidCents: number;
  grants: number;
  invoices: number;
};

export type WeeklyPoint = {
  /** Chart components key on `date`. */
  date: string;
  promoUsers: number;
  promoDiagnostics: number;
  controlUsers: number;
  controlDiagnostics: number;
  promoPerUser: number;
  controlPerUser: number;
};

export type RelativePoint = {
  date: string;
  relWeek: number;
  diagnostics: number;
  users: number;
};

export type EventKind =
  | "promo"
  | "call"
  | "email"
  | "reply"
  | "diagnosis"
  | "signup";

export type TimelineEvent = {
  id: string;
  at: string;
  kind: EventKind;
  /** Who did it: rep name for a call, sending mailbox for an email. */
  actor: string | null;
  title: string;
  detail: string | null;
  /** Set on calls: connected / no answer, plus duration. */
  outcome: string | null;
};

export type TimelineUser = {
  userId: string;
  email: string | null;
  workshop: string | null;
  code: string | null;
  appliedAt: string | null;
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
  /** Days between the promo landing and this call. Negative = before. */
  daysFromPromo: number | null;
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
  daysFromPromo: number | null;
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

export type BeforeAfterRow = {
  label: string;
  before: number;
  after: number;
  delta: number;
  users: number;
};

export type PromoEngagementBucket = {
  key: "never_logged_in" | "logged_in_no_diagnosis" | "one_diagnosis" | "repeat";
  label: string;
  description: string;
  count: number;
  emails: string[];
};

export type PromoOutreachBucket = {
  key: "called_and_emailed" | "emailed_only" | "called_only" | "neither";
  label: string;
  count: number;
  emails: string[];
};

export type PromoUsersKpis = {
  recipients: number;
  users: number;
  externalRecipients: number;
  internalRecipients: number;
  activeNow: number;
  everPaid: number;
  neverDiagnosed: number;
  neverContacted: number;
  everCalled: number;
  distinctCodes: number;
  medianDaysToFirstUse: number | null;
};

export type PromoUsersData = {
  kpis: PromoUsersKpis;
  money: PromoMoneyTotal[];
  cohorts: CohortStats[];
  checkoutComposition: CheckoutComposition | null;
  users: PromoUserRow[];
  grants: PromoGrantRowView[];
  codes: PromoCodeRow[];
  weekly: WeeklyPoint[];
  relative: RelativePoint[];
  beforeAfter: BeforeAfterRow[];
  timeline: TimelineUser[];
  calls: CallLogRow[];
  emails: EmailLogRow[];
  funnel: FunnelStage[];
  engagement: PromoEngagementBucket[];
  outreach: PromoOutreachBucket[];
  searchTerms: TermCount[];
  carMakes: TermCount[];
  dtcs: TermCount[];
  symptoms: TermCount[];
  unresolvedGrants: number;
  note: string;
  error: string | null;
};

/**
 * Build the "90% off, 14 mo" label. Exported so the loader and any test agree
 * on one phrasing instead of formatting coupon terms in two places.
 */
export function couponTerms(
  percentOff: number | null,
  amountOffCents: number | null,
  currency: string | null,
  duration: string | null,
  durationInMonths: number | null,
): string {
  const size =
    percentOff !== null
      ? `${Number(percentOff)}% off`
      : amountOffCents !== null
        ? `${Math.round(amountOffCents / 100)} ${(currency ?? "").toUpperCase()} off`
        : "discount";

  const span =
    duration === "forever"
      ? "forever"
      : duration === "once"
        ? "once"
        : durationInMonths
          ? `${durationInMonths} mo`
          : (duration ?? "");

  return span ? `${size}, ${span}` : size;
}

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
