// Client-safe types and constants for /dashboard/paying-customers.
//
// The page answers one question the rest of the dashboard does not: of the
// people an ad brought in, which ones actually started paying us money — not
// signed up, and not entered a card.
//
// That distinction is the whole point. This account has three different things
// that all get called a conversion somewhere, and they differ by an order of
// magnitude:
//
//   signed up          a free account exists
//   reached checkout   a card was entered and a trial began
//   paid               Stripe actually charged them at least once
//
// Google Ads calls the middle one "purchase" and bids on the first one. Only
// the third is revenue.

/** First day an ad ran. Nobody before this can be ad-acquired. */
export const ADS_ERA_START = "2026-05-19";

/**
 * Days a signup gets to become a payer before it counts in a rate.
 *
 * Without this the comparison is rigged: ad traffic is much newer than direct
 * traffic, so a raw side-by-side charges ads for cohorts that have not had time
 * to convert. 60 days covers the 7/14/30-day trials plus a first billing cycle.
 */
export const MATURITY_DAYS = 60;

/** Same fixed rate the campaigns, CAC/LTV and Google Ads Users pages use. */
export const USD_TO_SEK = 9.6;

export const PAYING_TABS = [
  { key: "funnel", label: "Ad click to payment" },
  { key: "customers", label: "Who actually pays" },
  { key: "reconciliation", label: "Google vs reality" },
  { key: "method", label: "How this is measured" },
] as const;

export type PayingTab = (typeof PAYING_TABS)[number]["key"];

/** One acquisition channel's full funnel, restricted to the mature cohort. */
export type ChannelFunnel = {
  channel: string;
  label: string;
  /** Workshops that signed up in the ads era and are past the maturity window. */
  workshops: number;
  activated: number;
  activatedPct: number;
  checkouts: number;
  checkoutPct: number;
  payers: number;
  paidPct: number;
  /** Of those who reached checkout, how many were ever charged. */
  checkoutToPaidPct: number;
  medianDaysToPaid: number | null;
};

/** A workshop that an ad brought in and that has actually been charged. */
export type PayingCustomerRow = {
  workshopId: string;
  name: string | null;
  country: string | null;
  channel: string;
  campaign: string | null;
  signedUpAt: string | null;
  checkoutAt: string | null;
  firstPaidAt: string | null;
  daysSignupToPaid: number | null;
  planKey: string | null;
  mrrMinorUnits: number | null;
  currency: string | null;
  status: string | null;
};

/** One month of "what Google counted" beside "what actually happened". */
export type ReconciliationRow = {
  month: string;
  /** Google Ads, the action it bids on. */
  googleSignups: number;
  /** Google Ads, the action it calls a purchase. */
  googlePurchases: number;
  googlePurchaseValue: number;
  /** Ours: ad-attributed workshops that entered a card that month. */
  ourAdCheckouts: number;
  /** Ours: ad-attributed workshops Stripe first charged that month. */
  ourAdFirstPayments: number;
};

/** A conversion action and whether it reaches the bidding algorithm at all. */
export type ConversionActionRow = {
  id: string;
  name: string;
  category: string | null;
  status: string | null;
  primaryForGoal: boolean | null;
  includeInConversionsMetric: boolean | null;
  countingType: string | null;
  /** True only when Google both counts it and treats it as a goal. */
  drivesBidding: boolean;
  last30dConversions: number;
  last30dValue: number;
};

export type CampaignPayerRow = {
  campaign: string;
  workshops: number;
  checkouts: number;
  payers: number;
  paidPct: number;
};

export type PayingCustomersData = {
  generatedAt: string;
  configured: boolean;
  emptyReason: string | null;
  /** Null when the Google-side sync has never run. */
  adsLastSyncedAt: string | null;

  // Headline
  adPayersAllTime: number;
  adCheckoutsAllTime: number;
  adSignupsAllTime: number;
  /** Ad spend since the ads era began, SEK. */
  adSpendSek: number;
  costPerAdPayerSek: number | null;
  costPerAdCheckoutSek: number | null;

  maturityCutoff: string;
  funnels: ChannelFunnel[];
  customers: PayingCustomerRow[];
  reconciliation: ReconciliationRow[];
  conversionActions: ConversionActionRow[];
  campaigns: CampaignPayerRow[];
};

export const CHANNEL_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  direct: "Direct",
  organic_search: "Organic search",
  email: "Email",
  referral: "Referral",
  other: "Other",
  unknown: "Unknown",
  none: "No GA4 data",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}
