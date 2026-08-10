// Client-safe constants and types for the Free Users page. Kept separate from
// src/lib/ceo/data/free-users.ts because that loader pulls in the server-only
// Supabase graph, which can't be imported from a "use client" component.

export const FREE_USERS_PAID_TIERS = [
  { key: "one", label: "One" },
  { key: "small", label: "Small" },
  { key: "large", label: "Large" },
] as const;

export type PaidTierKey = (typeof FREE_USERS_PAID_TIERS)[number]["key"];

export type FreeUsersKpis = {
  freeUsers: number;
  freeWorkshops: number;
  active7d: number;
  active30d: number;
  everActive: number;
  everDiagnosed: number;
  paidWorkshopsNow: number;
  payingActiveNow: number;
  trialingNow: number;
  pastDueNow: number;
  conversionRatePct: number;
};

export type TierStatusBreakdown = {
  tier: PaidTierKey;
  label: string;
  workshops: number;
  active: number;
  trialing: number;
  pastDue: number;
  other: number;
  topCountries: Array<{ country: string; workshops: number }>;
};

export type ActivityBucketRow = {
  bucket: string;
  users: number;
  sharePct: number;
};

export type FeatureMixRow = {
  key: string;
  label: string;
  users30d: number;
  events30d: number;
  usersAll: number;
  eventsAll: number;
};

export type ActivationStats = {
  everDiagnosedPct: number;
  firstDiagDay1Pct: number;
  medianDaysToFirstDiag: number | null;
  returnedAfterWeekPct: number;
  returnedAfterWeekBase: number;
};

export type CohortRow = {
  month: string;
  workshops: number;
  stillFree: number;
  paidTierNow: number;
  payingActive: number;
  trialing: number;
  conversionPct: number;
};

export type CountryRow = {
  country: string;
  workshops: number;
  freeWorkshops: number;
  paidNow: number;
  payingActive: number;
  conversionPct: number;
};

export type NewPaidTrendRow = {
  month: string;
  newPaid: number;
};

export type EngagedFreeUserRow = {
  internalUserId: string;
  name: string | null;
  username: string | null;
  company: string | null;
  workshopId: string | null;
  country: string | null;
  featureEvents30d: number;
  activeDays30d: number;
  diags30d: number;
  diagsAll: number;
  lastActiveDate: string | null;
  signedUpAt: string | null;
};

// ---- Upgrade funnel (Free → 14-day card trial → paid) ---------------------
//
// Product model: EVERY signup lands on Free — there is no direct paid signup.
// Upgrading to One/Small/Large starts a 14-day free trial that requires a
// card; cancelling (during or after the trial) reverts the workshop to Free.
// So every paid workshop is a converted free user, and the free pool contains
// an invisible population that upgraded and came back.
//
// Historical funnel states are reconstructed from Stripe fingerprints on the
// workshop row: a `core_stripe_subscription_id` on a FREE workshop means a
// subscription existed and was cancelled (reverted upgrade); a customer id
// without a subscription id means checkout was started but never completed
// (abandoned). Paid workshops without any Stripe id are manually provisioned
// or comped (mostly Large pilots) and sit outside the self-serve funnel.

export type UpgradeFunnel = {
  freeNow: number;
  checkoutStarted: number;
  trialsStarted: number;
  paidManualNoStripe: number;
  trialingNow: number;
  payingNow: number;
  pastDueNow: number;
  revertedToFree: number;
  revertedNeverUsed: number;
  abandonedCheckout: number;
  completedTrials: number;
  trialSurvivalPct: number;
  payingSurvivalPct: number;
};

export type LiveTrialRow = {
  workshopId: string;
  name: string | null;
  tier: string;
  country: string | null;
  trialEnd: string | null;
  daysLeft: number | null;
  activeDays14: number;
  diags14: number;
  lastActiveDate: string | null;
};

export type RevertedWorkshopRow = {
  workshopId: string;
  name: string | null;
  country: string | null;
  signupMonth: string | null;
  paymentFailed: boolean;
  diagsLifetime: number;
  activeDays30: number;
  lastActiveDate: string | null;
};

export type PaymentFailedRow = {
  workshopId: string;
  name: string | null;
  tier: string;
  country: string | null;
  status: string | null;
};

export type FreeUsersData = {
  note: string;
  kpis: FreeUsersKpis;
  tiers: TierStatusBreakdown[];
  activityBuckets: ActivityBucketRow[];
  featureMix: FeatureMixRow[];
  activation: ActivationStats;
  cohorts: CohortRow[];
  countries: CountryRow[];
  newPaidTrend: NewPaidTrendRow[];
  engagedUsers: EngagedFreeUserRow[];
  funnel: UpgradeFunnel;
  liveTrials: LiveTrialRow[];
  revertedWorkshops: RevertedWorkshopRow[];
  paymentFailed: PaymentFailedRow[];
};
