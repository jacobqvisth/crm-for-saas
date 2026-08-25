// Shared types + the hand-curated campaign catalog for /dashboard/campaigns.
//
// Why a catalog at all: GA4 is the only Google Ads data source we have (there
// is no Google Ads API developer token, see _planning/google-ads/), and GA4
// only ever sees campaigns that actually served an impression. Paused
// campaigns are therefore invisible in the numbers. The catalog records what
// each campaign IS and WHY it exists; the loader joins whatever live
// performance GA4 has against it, and lists any campaign found in the data
// that the catalog does not know about, so nothing is silently hidden.

// dashboard_metric_snapshots stores Google Ads spend in USD (GA4 reports it
// that way). The ad account itself bills in SEK. Same rate the CAC/LTV and
// Google Ads Users pages use, so the three pages agree.
export const USD_TO_SEK = 9.6;

export type CampaignStatus = "live" | "paused" | "retired" | "planned";

export type CampaignType = "performance_max" | "demand_gen" | "search";

export type CampaignPurpose = "acquisition" | "upsell" | "brand";

export type CatalogCampaign = {
  /** Name as it appears in Google Ads, and as GA4 reports it. */
  name: string;
  /** Names this campaign has also been reported under, for data matching. */
  aliases?: string[];
  type: CampaignType;
  status: CampaignStatus;
  purpose: CampaignPurpose;
  /** Plain-English: who this is meant to reach. */
  audience: string;
  /** Where the click lands. */
  landingPage: string | null;
  /** Budget as configured, in the account currency (SEK). */
  dailyBudgetSek: number | null;
  bidding: string;
  geo: string;
  /** Why this campaign exists at all, for a reader who was not in the room. */
  rationale: string;
  /** Anything the reader should distrust or watch. */
  caveat?: string;
};

export type CampaignTypeExplainer = {
  type: CampaignType;
  label: string;
  youControl: string[];
  googleControls: string[];
  inventory: string;
  creative: string;
  bestFor: string;
  watchOut: string;
};

/** CEO-facing explainer of how the three campaign types actually differ. */
export const CAMPAIGN_TYPE_EXPLAINERS: CampaignTypeExplainer[] = [
  {
    type: "performance_max",
    label: "Performance Max",
    youControl: [
      "Budget and target CPA/ROAS",
      "Creative assets (text, images, video)",
      "Audience signals (hints, not rules)",
      "Negative keywords and brand exclusions",
    ],
    googleControls: [
      "Which query or placement triggers the ad",
      "Which channel it serves on",
      "Which asset combination is shown",
      "Which landing page, if URL expansion is on",
    ],
    inventory: "Everything: Search, Display, YouTube, Gmail, Discover, Maps",
    creative: "Text plus images and video, assembled by Google",
    bestFor:
      "Cheap reach and volume when you do not need control over which query buys which page.",
    watchOut:
      "You cannot route a specific audience to a specific landing page. There are no keywords, so plan intent cannot be separated.",
  },
  {
    type: "demand_gen",
    label: "Demand Gen",
    youControl: [
      "Budget and bidding",
      "Creative assets (image and video led)",
      "Audience segments and lookalikes",
      "Placement opt-outs",
    ],
    googleControls: [
      "Delivery and pacing across surfaces",
      "Which creative is shown to whom",
    ],
    inventory: "YouTube, Discover, Gmail. No Search results pages",
    creative: "Image and video first, text is secondary",
    bestFor:
      "Building awareness with people who are not searching yet. Demand creation rather than demand capture.",
    watchOut:
      "It is not intent-driven. Clicks are cheap but colder than Search, so judge it on assisted conversions, not last click.",
  },
  {
    type: "search",
    label: "Search",
    youControl: [
      "Exact keywords and match types",
      "One fixed landing page per campaign",
      "Max CPC bid",
      "Audience targeting or exclusion",
      "Ad headlines and descriptions",
    ],
    googleControls: [
      "Which of your headlines are combined",
      "Auction position",
    ],
    inventory: "Google Search results and search partners only",
    creative: "Text only. No images, no video",
    bestFor:
      "Capturing people who are already looking, and sending each intent to the page built for it.",
    watchOut:
      "Far more expensive per click than PMax on this account. The retired us-generic Search campaign averaged 4.78 USD per click against PMax's 0.28 USD.",
  },
];

/**
 * The campaign catalog. Structure and intent only.
 * Spend comes from GA4 via dashboard_metric_snapshots, never from here.
 */
export const CAMPAIGN_CATALOG: CatalogCampaign[] = [
  {
    name: "Pmax eng may 2026",
    type: "performance_max",
    status: "live",
    purpose: "acquisition",
    audience:
      "Broad, English speaking. Google decides who sees it from the audience signals and conversion history.",
    landingPage: "Google's choice (final URL expansion)",
    dailyBudgetSek: null,
    bidding: "Smart Bidding",
    geo: "English-language markets",
    rationale:
      "The workhorse. It is where almost all paid volume and almost all paid signups have come from since May 2026, at a very low cost per click.",
    caveat:
      "It cannot send different audiences to different plan pages, which is exactly why the plan-targeted Search campaigns were built alongside it.",
  },
  {
    name: "Demand Gen – 2026-06-16",
    aliases: ["Demand Gen - 2026-06-16", "Demand Gen"],
    type: "demand_gen",
    status: "live",
    purpose: "acquisition",
    audience:
      "Mechanics and workshop owners on YouTube, Discover and Gmail who are not actively searching.",
    landingPage: "Google's choice",
    dailyBudgetSek: null,
    bidding: "Smart Bidding",
    geo: "English-language markets",
    rationale:
      "Demand creation above the funnel, to feed the audiences PMax and Search later capture.",
    caveat:
      "Judge on assisted conversions. Last-click will always make this look worse than it is.",
  },
  {
    name: "WL Plan | One",
    type: "search",
    // Enabled 2026-08-24. Confirmed live by GA4 impressions, not by hand.
    status: "live",
    purpose: "acquisition",
    audience:
      "Someone looking after a single vehicle. Solo mechanic or serious owner-operator.",
    landingPage: "wrenchlane.com/en/wrenchlane-one",
    dailyBudgetSek: 96,
    bidding: "Manual CPC",
    geo: "US, UK, Sweden. English",
    rationale:
      "First of the plan-targeted campaigns. Single-vehicle intent goes to the One page and its 19 USD price, instead of a generic page that has to sell four plans at once.",
    caveat:
      "Serving, but only barely: a couple of impressions a day and no clicks yet. That is the signature of a max CPC set too low to win auctions, which is the first thing to check before concluding the keywords are wrong.",
  },
  {
    name: "WL Plan | Small",
    type: "search",
    // Enabled 2026-08-24. Confirmed live by GA4 impressions, not by hand.
    status: "live",
    purpose: "acquisition",
    audience:
      "Independent workshops with one or two mechanics. Includes a second ad group for people searching for alternatives to competing repair-data tools.",
    landingPage: "wrenchlane.com/en/small",
    dailyBudgetSek: 96,
    bidding: "Manual CPC",
    geo: "US, UK, Sweden. English",
    rationale:
      "Small is the most-picked paid tier, so it gets the widest keyword coverage of the three, including competitor alternative terms that pair with the /compare and /vs pages.",
    caveat:
      "Two things to watch. Competitor names are used as keywords only, never in the ad text, because using a rival trademark in copy is against Google policy. And like the One campaign it is serving only a handful of impressions a day with no clicks, which points at the max CPC rather than the keywords.",
  },
  {
    name: "WL Plan | Large",
    type: "search",
    status: "paused",
    purpose: "acquisition",
    audience:
      "Workshops running three to ten technicians who need shared access across a team.",
    landingPage: "wrenchlane.com/en/large",
    dailyBudgetSek: 96,
    bidding: "Manual CPC",
    geo: "US, UK, Sweden. English",
    rationale:
      "Highest revenue per customer at 195 USD a month, so it can carry a much higher cost per click than the other two before it stops making sense.",
  },
  {
    name: "WL Plan | Upsell Free Users",
    type: "search",
    status: "planned",
    purpose: "upsell",
    audience:
      "Our own existing free-plan users, matched by hashed email through the WL Free Users Customer Match audience.",
    landingPage: "wrenchlane.com/en/pricing",
    dailyBudgetSek: 96,
    bidding: "Manual CPC",
    geo: "US, UK, Sweden. English",
    rationale:
      "The only campaign pointed at people who already have an account. Roughly 1,560 free users have signed up and never paid, and activation is the biggest leak in the funnel, so re-reaching them is cheaper than buying a new signup.",
    caveat:
      "Search-with-audience only serves when those users happen to search, so volume is inherently low. Higher-volume Display or Demand Gen remarketing needs uploaded image assets.",
  },
  {
    name: "us-generic",
    type: "search",
    status: "retired",
    purpose: "acquisition",
    audience: "Broad US search intent.",
    landingPage: "Generic",
    dailyBudgetSek: null,
    bidding: "Manual CPC",
    geo: "United States",
    rationale:
      "An early Search test, stopped in May 2026. It is the single most useful benchmark available: it tells us what Search actually costs on this vocabulary.",
    caveat:
      "It averaged 4.78 USD per click for 273 clicks. Any new Search campaign has to clear a bid near that level or it will simply never serve.",
  },
  {
    name: "uk-generic",
    type: "search",
    status: "retired",
    purpose: "acquisition",
    audience: "Broad UK search intent.",
    landingPage: "Generic",
    dailyBudgetSek: null,
    bidding: "Manual CPC",
    geo: "United Kingdom",
    rationale: "UK counterpart to us-generic, stopped in June 2026.",
    caveat: "Cheaper than the US at about 1.04 USD per click, on 492 clicks.",
  },
  {
    name: "us-codes+make",
    type: "search",
    status: "retired",
    purpose: "acquisition",
    audience: "US searches combining a fault code with a vehicle make.",
    landingPage: "Generic",
    dailyBudgetSek: null,
    bidding: "Manual CPC",
    geo: "United States",
    rationale:
      "Tested the highest-intent vocabulary available, fault code plus make. Stopped in May 2026 before it gathered meaningful volume.",
  },
];

export type CampaignPerformance = {
  name: string;
  catalog: CatalogCampaign | null;
  spendSek: number;
  clicks: number;
  impressions: number;
  cpcSek: number | null;
  ctrPct: number | null;
  firstDay: string | null;
  lastDay: string | null;
  /**
   * Users whose GA4 first touch was this campaign, from
   * dashboard_user_attribution. Lifetime, not windowed: first touch is a
   * property of the user, not of the reporting period. Null when the
   * attribution read failed.
   */
  attributedUsers: number | null;
  /** Spend per attributed user, SEK. Only meaningful all-time. */
  costPerUserSek: number | null;
};

export type SpendTrendPoint = {
  month: string;
  byCampaign: Record<string, number>;
  totalSek: number;
};

/** One day of performance for a single campaign. */
export type DailyPoint = {
  date: string;
  spendSek: number;
  clicks: number;
  impressions: number;
};

/** One month of performance for a single campaign. */
export type MonthlyPoint = {
  month: string;
  spendSek: number;
  clicks: number;
  impressions: number;
  /** Users whose GA4 first touch was this campaign, in this month. */
  users: number;
};

/**
 * Everything the per-campaign tab needs. Built for every catalogued campaign
 * that is not retired, whether or not GA4 has any data for it: a paused
 * campaign still has structure, creative and keywords worth showing.
 */
export type CampaignDetail = {
  catalog: CatalogCampaign;
  performance: CampaignPerformance | null;
  daily: DailyPoint[];
  monthly: MonthlyPoint[];
  /** Share of all Google Ads spend, all time. */
  spendSharePct: number | null;
  /**
   * Set when GA4 contradicts the hand-maintained status: the catalog says
   * paused or not-yet-built, but the campaign served impressions recently.
   * Status is edited by hand and therefore goes stale the moment someone
   * enables a campaign in the Google Ads UI, so the page detects that rather
   * than trusting itself.
   */
  statusDiscrepancy: string | null;
  /**
   * Live but almost invisible: serving impressions yet winning no clicks.
   * On this account that nearly always means the max CPC is below what the
   * auction costs, not that the keywords are wrong.
   */
  lowDeliveryWarning: string | null;
};

/** Impressions in the last N days is what counts as "recently serving". */
export const RECENT_SERVING_DAYS = 7;

export type CampaignsKpis = {
  totalSpendSek: number;
  totalClicks: number;
  totalImpressions: number;
  blendedCpcSek: number | null;
  blendedCtrPct: number | null;
  liveCampaigns: number;
  pausedOrPlanned: number;
  firstDay: string | null;
  lastDay: string | null;
};

export type WindowedPerformance = {
  label: string;
  days: number | null;
  rows: CampaignPerformance[];
  totalSpendSek: number;
};

export type CampaignsData = {
  kpis: CampaignsKpis;
  allTime: CampaignPerformance[];
  windows: WindowedPerformance[];
  trend: SpendTrendPoint[];
  noDataCampaigns: CatalogCampaign[];
  attribution: {
    googleAdsUsers: number;
    totalAttributedUsers: number;
    googleAdsSharePct: number;
  } | null;
  /**
   * One entry per non-retired catalogued campaign, in tab order. Retired
   * campaigns keep their rows in the overview tables (deleting them would
   * misstate spend history) but get no tab of their own.
   */
  details: CampaignDetail[];
};

/** Campaigns that get their own tab: everything except retired. */
export function isTabbed(campaign: CatalogCampaign): boolean {
  return campaign.status !== "retired";
}

/** Campaign names GA4 emits that are not real campaigns. */
export const NON_CAMPAIGN_NAMES = new Set([
  "(not set)",
  "(organic)",
  "(none)",
  "unknown",
  "Unknown campaign",
]);

/**
 * Turn a raw GA4 campaign dimension into a real campaign name, or null.
 *
 * GA4 emits three kinds of junk in this dimension: the literal placeholders in
 * NON_CAMPAIGN_NAMES, empty strings, and a bare numeric campaign id for days
 * where the name had not propagated yet (we have seen "23856272781" sitting
 * alongside the named "Pmax eng may 2026" rows for the same campaign). Counting
 * that id as its own campaign would both invent a phantom row and understate
 * the real one, so it is dropped.
 */
export function normalizeCampaignName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name) return null;
  if (NON_CAMPAIGN_NAMES.has(name)) return null;
  if (/^\d+$/.test(name)) return null;
  return name;
}

export function findCatalogEntry(name: string): CatalogCampaign | null {
  const needle = name.trim().toLowerCase();
  return (
    CAMPAIGN_CATALOG.find(
      (c) =>
        c.name.toLowerCase() === needle ||
        (c.aliases ?? []).some((a) => a.toLowerCase() === needle),
    ) ?? null
  );
}

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  live: "Live",
  paused: "Paused",
  retired: "Retired",
  planned: "Not built yet",
};

export const TYPE_LABELS: Record<CampaignType, string> = {
  performance_max: "Performance Max",
  demand_gen: "Demand Gen",
  search: "Search",
};

export const PURPOSE_LABELS: Record<CampaignPurpose, string> = {
  acquisition: "Acquisition",
  upsell: "Upsell",
  brand: "Brand",
};
