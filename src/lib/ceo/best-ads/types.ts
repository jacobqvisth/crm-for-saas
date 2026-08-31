// Shared types for /dashboard/best-ads.

/**
 * Which Google Ads report a row came from. The two count differently and must
 * never be pooled — see the migration comment. `ad_group_ad` metrics belong to
 * the ad the asset served in; `campaign_asset` metrics for sitelinks and
 * callouts are genuinely that asset's own clicks.
 */
export type AssetSurface = "ad_group_ad" | "campaign_asset";

export type AssetKind = "text" | "image" | "video" | "other";

export type AssetCreative = {
  assetId: string;
  assetType: string;
  kind: AssetKind;
  name: string | null;
  text: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  youtubeVideoId: string | null;
  youtubeVideoTitle: string | null;
};

export type AssetRollupRow = AssetCreative & {
  fieldType: string;
  surface: AssetSurface;
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  conversionsValue: number;
  campaignNames: string[];
  channelTypes: string[];
  firstDay: string | null;
  lastDay: string | null;
};

/** An asset that exists in the account but reports no metrics at all. */
export type AssetPlacement = AssetCreative & {
  container: string;
  containerId: string;
  containerName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  fieldType: string;
  status: string | null;
};

export const BEST_ADS_WINDOWS = [
  { key: "d30", label: "Last 30 days", days: 30 },
  { key: "d90", label: "Last 90 days", days: 90 },
  { key: "d365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

export type BestAdsWindowKey = (typeof BEST_ADS_WINDOWS)[number]["key"];

export const BEST_ADS_TABS = [
  { key: "text", label: "Headlines & copy" },
  { key: "visual", label: "Images & video" },
  { key: "extensions", label: "Sitelinks & callouts" },
  { key: "playbook", label: "Playbook" },
  { key: "method", label: "How this is scored" },
] as const;

export type BestAdsTab = (typeof BEST_ADS_TABS)[number]["key"];

/**
 * A phrasing pattern found across several assets — the unit the page is
 * actually for. One winning headline is an anecdote; the same angle winning
 * across six is a brief for the next batch.
 */
export type ThemeSummary = {
  key: string;
  label: string;
  description: string;
  assets: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cvr: number;
  ctrIndex: number;
  cvrIndex: number;
  examples: { text: string; ctr: number; impressions: number }[];
};
