// Client-safe types + constants for /dashboard/google-ads-users.
//
// Cohort model: every non-internal-test app user lands in exactly one of
// three cohorts. "google_ads" = GA4 first-touch says the user's first visit
// came from a Google Ads click AND they signed up after Pmax launched.
// "ads_era_other" = signed up in the ads era but first touch was something
// else (direct, organic, email, referral) or GA4 never identified them.
// "pre_ads" = signed up before the first ad ran, so they cannot be
// ad-acquired regardless of what GA4 says (a later ad click by an old user
// can look like a first touch for users who predate the May 25 user-ID
// wiring).

export const ADS_ERA_START = "2026-05-19";
export const USER_ID_WIRING_DATE = "2026-05-25";
export const USD_TO_SEK = 9.6;

export const COHORT_KEYS = ["google_ads", "ads_era_other", "pre_ads"] as const;
export type CohortKey = (typeof COHORT_KEYS)[number];

export const COHORT_LABELS: Record<CohortKey, string> = {
  google_ads: "Google Ads users",
  ads_era_other: "Ads-era, other origin",
  pre_ads: "Pre-ads signups",
};

export type CohortBehavior = {
  key: CohortKey;
  label: string;
  users: number;
  workshops: number;
  activatedUsers: number;
  activationPct: number;
  medianDaysToFirstDiagnostic: number | null;
  medianDiagnosticsPerActivated: number | null;
  usersWithChatPct: number;
  activeLast30dPct: number;
  churnedPct: number;
};

export type CohortMonetization = {
  key: CohortKey;
  label: string;
  workshops: number;
  trialWorkshops: number;
  trialPct: number;
  payerWorkshops: number;
  payerPct: number;
  trialToPaidPct: number;
  activeSubWorkshops: number;
  medianDaysToFirstPaid: number | null;
  estMrrSek: number;
  estRevenueToDateSek: number;
};

export type FeatureAdoptionRow = {
  featureKey: string;
  label: string;
  // Percent of cohort users with at least one tracked usage.
  pctByCohort: Record<CohortKey, number>;
};

export type CampaignRow = {
  campaign: string;
  users: number;
  activatedUsers: number;
  payerWorkshops: number;
  signupToPaidPct: number;
};

export type MonthlySignupRow = {
  month: string; // YYYY-MM
  googleAds: number;
  adsEraOther: number;
  preAds: number;
  attributedPct: number; // GA4 coverage of that month's signups
};

export type PlanMixRow = {
  tierKey: string;
  tierLabel: string;
  adsPayers: number;
  otherPayers: number;
};

export type CountryRow = {
  country: string;
  users: number;
  payerWorkshops: number;
};

export type LtvScenarioRow = {
  monthlyChurnPct: number;
  ltvSek: number;
  ltvCacRatio: number | null;
  paybackMonths: number | null;
};

export type GoogleAdsEconomics = {
  spendUsd: number;
  spendSek: number;
  spendSinceDate: string;
  adClicks: number;
  costPerSignupSek: number | null;
  cacPerPayerSek: number | null;
  arpaSekPerPayerMonth: number | null;
  assumedGrossMarginPct: number;
  scenarios: LtvScenarioRow[];
};

export type GoogleAdsUsersData = {
  generatedAt: string;
  // Headline
  totalUsers: number;
  adsEraUsers: number;
  adsUsers: number;
  adsShareOfAdsEraPct: number;
  adsShareOfAllPct: number;
  attributedUsers: number;
  attributionCoveragePct: number;
  adsPayerWorkshops: number;
  // Sections
  monthlySignups: MonthlySignupRow[];
  behavior: CohortBehavior[];
  featureAdoption: FeatureAdoptionRow[];
  monetization: CohortMonetization[];
  planMix: PlanMixRow[];
  campaigns: CampaignRow[];
  countries: CountryRow[];
  economics: GoogleAdsEconomics;
  error?: string;
};
