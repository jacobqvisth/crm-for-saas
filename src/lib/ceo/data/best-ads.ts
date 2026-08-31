// Loader for /dashboard/best-ads.
//
// Reads the asset tables written by /api/cron/sync-google-ads-assets, scores
// every asset against the baseline for its own field type, and ships four
// pre-computed windows so the page's range tabs switch without a round trip.
//
// Aggregation happens in Postgres, not here, and that is not a preference.
// PostgREST truncates ANY response at 1000 rows, RPCs included, with no error
// and no warning — the account's ~19,000 daily rows would arrive as an
// arbitrary 5% and every number on the page would be quietly wrong. The
// `dashboard_ad_asset_rollup` function collapses them to ~300 rows per window,
// safely inside the ceiling, and is called once per window rather than being
// asked for all four at once.

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { scoreAssets, type FieldTypeBaseline, type ScoredAsset } from "@/lib/ceo/best-ads/ranking";
import { summariseThemes, textBaseline } from "@/lib/ceo/best-ads/themes";
import {
  BEST_ADS_WINDOWS,
  type AssetKind,
  type AssetPlacement,
  type AssetRollupRow,
  type AssetSurface,
  type BestAdsWindowKey,
  type ThemeSummary,
} from "@/lib/ceo/best-ads/types";

type AssetDimensionRow = {
  asset_id: string;
  asset_type: string | null;
  name: string | null;
  text_content: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  youtube_video_id: string | null;
  youtube_video_title: string | null;
  synced_at: string | null;
};

type RollupRow = {
  asset_id: string;
  field_type: string;
  surface: string;
  impressions: number | string | null;
  clicks: number | string | null;
  cost_micros: number | string | null;
  conversions: number | string | null;
  conversions_value: number | string | null;
  campaign_names: string[] | null;
  channel_types: string[] | null;
  first_day: string | null;
  last_day: string | null;
};

type PlacementRow = {
  asset_id: string;
  container: string;
  container_id: string;
  container_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  field_type: string;
  status: string | null;
};

export type BestAdsWindow = {
  key: BestAdsWindowKey;
  label: string;
  start: string;
  end: string;
  assets: ScoredAsset[];
  baselines: FieldTypeBaseline[];
  themes: ThemeSummary[];
  copyBaseline: ReturnType<typeof textBaseline>;
};

export type BestAdsData = {
  configured: boolean;
  /** Set when the sync has never run, so the page can say so instead of "0". */
  emptyReason: string | null;
  lastSyncedAt: string | null;
  windows: BestAdsWindow[];
  /** Live creatives that report no metrics at all — every Performance Max asset. */
  unmeasured: AssetPlacement[];
  totalAssets: number;
};

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Coarse grouping for display. `asset_type` has a dozen values but the page
 * only ever branches three ways: render the words, render the picture, render
 * the thumbnail.
 */
function assetKind(assetType: string | null): AssetKind {
  switch (assetType) {
    case "TEXT":
      return "text";
    case "IMAGE":
    case "MEDIA_BUNDLE":
      return "image";
    case "YOUTUBE_VIDEO":
      return "video";
    default:
      return "other";
  }
}

function toSurface(value: string): AssetSurface {
  return value === "campaign_asset" ? "campaign_asset" : "ad_group_ad";
}

function creativeFrom(dimension: AssetDimensionRow | undefined, assetId: string) {
  return {
    assetId,
    assetType: dimension?.asset_type ?? "UNKNOWN",
    kind: assetKind(dimension?.asset_type ?? null),
    name: dimension?.name ?? null,
    text: dimension?.text_content ?? null,
    imageUrl: dimension?.image_url ?? null,
    imageWidth: dimension?.image_width ?? null,
    imageHeight: dimension?.image_height ?? null,
    youtubeVideoId: dimension?.youtube_video_id ?? null,
    youtubeVideoTitle: dimension?.youtube_video_title ?? null,
  };
}

async function loadBestAds(): Promise<BestAdsData> {
  const supabase = createSupabaseServiceClient();
  const empty: BestAdsData = {
    configured: false,
    emptyReason: "Supabase service client is not configured.",
    lastSyncedAt: null,
    windows: [],
    unmeasured: [],
    totalAssets: 0,
  };
  if (!supabase) return empty;

  // The dimension table is one row per creative — a few hundred — so a plain
  // select is honest here. It is also the only read on this page that could
  // ever approach the 1000-row ceiling as the account grows, which is why the
  // count is checked against it below rather than assumed.
  const { data: assetRows, error: assetError } = await supabase
    .from("dashboard_ad_assets")
    .select(
      "asset_id, asset_type, name, text_content, image_url, image_width, image_height, youtube_video_id, youtube_video_title, synced_at",
    )
    .order("asset_id", { ascending: true })
    .range(0, 4999);

  if (assetError) {
    return {
      ...empty,
      configured: true,
      emptyReason: `Could not read ad assets: ${assetError.message}`,
    };
  }

  const dimensions = new Map<string, AssetDimensionRow>(
    (assetRows ?? []).map((row) => [row.asset_id, row as AssetDimensionRow]),
  );

  if (dimensions.size === 0) {
    return {
      configured: true,
      emptyReason:
        "No asset data yet. Run /api/cron/sync-google-ads-assets once to populate it.",
      lastSyncedAt: null,
      windows: [],
      unmeasured: [],
      totalAssets: 0,
    };
  }

  const lastSyncedAt = (assetRows ?? []).reduce<string | null>((latest, row) => {
    const value = (row as AssetDimensionRow).synced_at;
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);

  const today = new Date();
  const end = isoDate(today);

  const windows: BestAdsWindow[] = [];

  for (const definition of BEST_ADS_WINDOWS) {
    const start = definition.days
      ? isoDate(new Date(today.getTime() - definition.days * 86_400_000))
      : "2000-01-01";

    const { data, error } = await supabase.rpc("dashboard_ad_asset_rollup", {
      p_start: start,
      p_end: end,
    });

    if (error) {
      return {
        ...empty,
        configured: true,
        emptyReason: `Rollup failed for ${definition.label}: ${error.message}`,
        lastSyncedAt,
      };
    }

    const rollup: AssetRollupRow[] = ((data ?? []) as RollupRow[]).map((row) => ({
      ...creativeFrom(dimensions.get(row.asset_id), row.asset_id),
      fieldType: row.field_type,
      surface: toSurface(row.surface),
      impressions: num(row.impressions),
      clicks: num(row.clicks),
      costMicros: num(row.cost_micros),
      conversions: num(row.conversions),
      conversionsValue: num(row.conversions_value),
      campaignNames: row.campaign_names ?? [],
      channelTypes: row.channel_types ?? [],
      firstDay: row.first_day,
      lastDay: row.last_day,
    }));

    const { scored, baselines } = scoreAssets(rollup);

    windows.push({
      key: definition.key,
      label: definition.label,
      start,
      end,
      assets: scored,
      baselines: [...baselines.values()].sort((a, b) => b.impressions - a.impressions),
      themes: summariseThemes(rollup),
      copyBaseline: textBaseline(rollup),
    });
  }

  // Everything that exists but reports nothing. Performance Max asset groups
  // expose no per-asset metrics on API v25 — checked against the live account,
  // not inferred from the docs — so without this list the page would imply the
  // PMax creatives, which are most of the account's spend, do not exist.
  const { data: placementRows } = await supabase
    .from("dashboard_ad_asset_placements")
    .select(
      "asset_id, container, container_id, container_name, campaign_id, campaign_name, field_type, status",
    )
    .eq("container", "asset_group")
    .order("asset_id", { ascending: true })
    .range(0, 999);

  const measured = new Set(
    windows.find((window) => window.key === "all")?.assets.map((asset) => asset.assetId) ??
      [],
  );

  const unmeasured: AssetPlacement[] = ((placementRows ?? []) as PlacementRow[])
    .filter((row) => !measured.has(row.asset_id))
    .map((row) => ({
      ...creativeFrom(dimensions.get(row.asset_id), row.asset_id),
      container: row.container,
      containerId: row.container_id,
      containerName: row.container_name,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      fieldType: row.field_type,
      status: row.status,
    }));

  return {
    configured: true,
    emptyReason: null,
    lastSyncedAt,
    windows,
    unmeasured,
    totalAssets: dimensions.size,
  };
}

export const getBestAdsData = unstable_cache(
  loadBestAds,
  ["ceo-best-ads"],
  CEO_CACHE_OPTIONS,
);
