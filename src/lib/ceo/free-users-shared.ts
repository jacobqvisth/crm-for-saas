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
};
