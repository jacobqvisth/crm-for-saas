// Pulls asset-level Google Ads performance into dashboard_ad_asset_* for
// /dashboard/best-ads. Driven by /api/cron/sync-google-ads-assets.
//
// Four reads, deliberately kept separate because they are four different
// guarantees:
//
//   1. ad_group_ad_asset_view   the real prize. Per-asset daily metrics for
//                               every responsive search ad and every Demand Gen
//                               ad — including images and videos.
//   2. campaign_asset           sitelinks and callouts, whose clicks ARE their
//                               own rather than the parent ad's.
//   3. asset_group_asset        Performance Max inventory. No metrics exist on
//                               API v25 — verified, not assumed — so these are
//                               stored as placements and shown as "no data".
//   4. asset                    creative bodies for anything the first three
//                               referenced but did not describe.
//
// Idempotent throughout: every write is an upsert on a natural key, so a re-run
// over an overlapping window corrects rather than duplicates.

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import {
  createGoogleAdsAccess,
  googleAdsSearch,
  GoogleAdsApiError,
  type GoogleAdsAccess,
} from "@/lib/ceo/sync/google-ads-client";
import { SyncSkippedError } from "@/lib/ceo/sync/errors";

/**
 * How far back a default run reaches.
 *
 * Long, because the account's most instructive campaigns are already paused —
 * us-codes+make bought 13,505 clicks and converted none of them, which is the
 * single most useful fact on the page and is entirely historical. A window that
 * only saw live campaigns would delete the lesson.
 */
const DEFAULT_LOOKBACK_DAYS = 900;

const UPSERT_BATCH = 500;

type SearchRow = {
  campaign?: { id?: string; name?: string; advertisingChannelType?: string };
  adGroup?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: {
    impressions?: string | number;
    clicks?: string | number;
    costMicros?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
  asset?: {
    id?: string;
    type?: string;
    name?: string;
    textAsset?: { text?: string };
    imageAsset?: {
      fullSize?: { url?: string; widthPixels?: string; heightPixels?: string };
    };
    youtubeVideoAsset?: { youtubeVideoId?: string; youtubeVideoTitle?: string };
    sitelinkAsset?: { linkText?: string };
    calloutAsset?: { calloutText?: string };
  };
  adGroupAdAssetView?: { fieldType?: string };
  campaignAsset?: { fieldType?: string; status?: string };
  assetGroup?: { id?: string; name?: string; status?: string };
  assetGroupAsset?: { fieldType?: string; status?: string; primaryStatus?: string };
};

type AssetRecord = {
  asset_id: string;
  asset_type: string;
  name: string | null;
  text_content: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  youtube_video_id: string | null;
  youtube_video_title: string | null;
  synced_at: string;
};

type MetricRecord = {
  asset_id: string;
  field_type: string;
  surface: string;
  campaign_id: string;
  campaign_name: string;
  channel_type: string | null;
  stat_date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
};

type PlacementRecord = {
  asset_id: string;
  container: string;
  container_id: string;
  container_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  field_type: string;
  status: string | null;
  synced_at: string;
};

export type SyncBestAdsResult = {
  ok: boolean;
  syncedAt: string;
  skipped?: boolean;
  reason?: string;
  start?: string;
  end?: string;
  assets?: number;
  metricRows?: number;
  placements?: number;
  warnings?: string[];
  error?: string;
};

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Best available human-readable body for an asset.
 *
 * Sitelinks and callouts carry their text on their own sub-object rather than
 * on `textAsset`, so a naive read leaves every extension on the page as a bare
 * numeric id.
 */
function assetText(asset: SearchRow["asset"]): string | null {
  return (
    asset?.textAsset?.text ??
    asset?.sitelinkAsset?.linkText ??
    asset?.calloutAsset?.calloutText ??
    null
  );
}

function toAssetRecord(asset: SearchRow["asset"], syncedAt: string): AssetRecord | null {
  if (!asset?.id) return null;
  const width = asset.imageAsset?.fullSize?.widthPixels;
  const height = asset.imageAsset?.fullSize?.heightPixels;
  return {
    asset_id: asset.id,
    asset_type: asset.type ?? "UNKNOWN",
    name: asset.name ?? null,
    text_content: assetText(asset),
    image_url: asset.imageAsset?.fullSize?.url ?? null,
    image_width: width ? num(width) : null,
    image_height: height ? num(height) : null,
    youtube_video_id: asset.youtubeVideoAsset?.youtubeVideoId ?? null,
    youtube_video_title: asset.youtubeVideoAsset?.youtubeVideoTitle ?? null,
    synced_at: syncedAt,
  };
}

/**
 * Merge two sightings of the same asset, preferring the one that knows more.
 *
 * The same asset is returned by several reports with different projections —
 * `campaign_asset` does not select image dimensions, for instance — so last
 * write would otherwise blank fields an earlier row had filled in correctly.
 */
function mergeAsset(existing: AssetRecord, incoming: AssetRecord): AssetRecord {
  return {
    asset_id: existing.asset_id,
    asset_type:
      existing.asset_type !== "UNKNOWN" ? existing.asset_type : incoming.asset_type,
    name: existing.name ?? incoming.name,
    text_content: existing.text_content ?? incoming.text_content,
    image_url: existing.image_url ?? incoming.image_url,
    image_width: existing.image_width ?? incoming.image_width,
    image_height: existing.image_height ?? incoming.image_height,
    youtube_video_id: existing.youtube_video_id ?? incoming.youtube_video_id,
    youtube_video_title: existing.youtube_video_title ?? incoming.youtube_video_title,
    synced_at: incoming.synced_at,
  };
}

/**
 * Fold daily rows into the metrics table's primary key.
 *
 * `ad_group_ad_asset_view` reports one row per AD, so an asset used by three ads
 * in the same campaign on the same day arrives three times. Upserting those
 * directly would let the last one win and silently discard the other two. They
 * are summed instead, which is the right operation: within one campaign-day the
 * three ads are genuinely different impressions.
 */
function foldMetrics(records: MetricRecord[]): MetricRecord[] {
  const byKey = new Map<string, MetricRecord>();
  for (const record of records) {
    const key = [
      record.asset_id,
      record.field_type,
      record.surface,
      record.campaign_id,
      record.stat_date,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...record });
      continue;
    }
    existing.impressions += record.impressions;
    existing.clicks += record.clicks;
    existing.cost_micros += record.cost_micros;
    existing.conversions += record.conversions;
    existing.conversions_value += record.conversions_value;
  }
  return [...byKey.values()];
}

async function readAdGroupAdAssets(
  access: GoogleAdsAccess,
  start: string,
  end: string,
): Promise<SearchRow[]> {
  return googleAdsSearch<SearchRow>(
    access,
    `SELECT
       campaign.id, campaign.name, campaign.advertising_channel_type,
       segments.date,
       ad_group_ad_asset_view.field_type,
       asset.id, asset.type, asset.name,
       asset.text_asset.text,
       asset.image_asset.full_size.url,
       asset.image_asset.full_size.width_pixels,
       asset.image_asset.full_size.height_pixels,
       asset.youtube_video_asset.youtube_video_id,
       asset.youtube_video_asset.youtube_video_title,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value
     FROM ad_group_ad_asset_view
     WHERE segments.date BETWEEN '${start}' AND '${end}'
       AND metrics.impressions > 0`,
  );
}

async function readCampaignAssets(
  access: GoogleAdsAccess,
  start: string,
  end: string,
): Promise<SearchRow[]> {
  return googleAdsSearch<SearchRow>(
    access,
    `SELECT
       campaign.id, campaign.name, campaign.advertising_channel_type,
       segments.date,
       campaign_asset.field_type, campaign_asset.status,
       asset.id, asset.type, asset.name,
       asset.text_asset.text,
       asset.sitelink_asset.link_text,
       asset.callout_asset.callout_text,
       asset.image_asset.full_size.url,
       asset.youtube_video_asset.youtube_video_id,
       asset.youtube_video_asset.youtube_video_title,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value
     FROM campaign_asset
     WHERE segments.date BETWEEN '${start}' AND '${end}'
       AND metrics.impressions > 0`,
  );
}

async function readAssetGroupAssets(access: GoogleAdsAccess): Promise<SearchRow[]> {
  // No date filter and no metrics: `asset_group_asset` supports neither on
  // v25. This is inventory, not performance.
  return googleAdsSearch<SearchRow>(
    access,
    `SELECT
       campaign.id, campaign.name,
       asset_group.id, asset_group.name, asset_group.status,
       asset_group_asset.field_type, asset_group_asset.status,
       asset_group_asset.primary_status,
       asset.id, asset.type, asset.name,
       asset.text_asset.text,
       asset.image_asset.full_size.url,
       asset.image_asset.full_size.width_pixels,
       asset.image_asset.full_size.height_pixels,
       asset.youtube_video_asset.youtube_video_id,
       asset.youtube_video_asset.youtube_video_title
     FROM asset_group_asset`,
  );
}

export async function syncBestAds(options?: {
  lookbackDays?: number;
}): Promise<SyncBestAdsResult> {
  const syncedAt = new Date().toISOString();
  const warnings: string[] = [];

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      ok: false,
      syncedAt,
      skipped: true,
      reason: "Supabase service client is not configured.",
    };
  }

  let access: GoogleAdsAccess;
  try {
    access = await createGoogleAdsAccess();
  } catch (error) {
    if (error instanceof SyncSkippedError) {
      // Missing configuration is not an outage. Recording it as "skipped" keeps
      // a cron that has simply never been given a token out of the alert
      // channel, where a daily failure would train everyone to ignore it.
      return { ok: true, syncedAt, skipped: true, reason: error.message };
    }
    throw error;
  }

  const lookbackDays = options?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 86_400_000);
  const start = isoDate(startDate);
  const end = isoDate(endDate);

  const assets = new Map<string, AssetRecord>();
  const rememberAsset = (row: SearchRow) => {
    const record = toAssetRecord(row.asset, syncedAt);
    if (!record) return;
    const existing = assets.get(record.asset_id);
    assets.set(record.asset_id, existing ? mergeAsset(existing, record) : record);
  };

  const metrics: MetricRecord[] = [];
  const placements: PlacementRecord[] = [];

  // ---- 1. per-ad asset performance -------------------------------------
  let adGroupRows: SearchRow[];
  try {
    adGroupRows = await readAdGroupAdAssets(access, start, end);
  } catch (error) {
    // This report is the page. If it is refused there is nothing to salvage,
    // so fail loudly rather than writing a page that silently shows nothing.
    return {
      ok: false,
      syncedAt,
      start,
      end,
      error:
        error instanceof GoogleAdsApiError
          ? `ad_group_ad_asset_view: ${error.message}`
          : String(error),
    };
  }

  for (const row of adGroupRows) {
    rememberAsset(row);
    const assetId = row.asset?.id;
    const fieldType = row.adGroupAdAssetView?.fieldType;
    const campaignId = row.campaign?.id;
    const date = row.segments?.date;
    if (!assetId || !fieldType || !campaignId || !date) continue;
    metrics.push({
      asset_id: assetId,
      field_type: fieldType,
      surface: "ad_group_ad",
      campaign_id: campaignId,
      campaign_name: row.campaign?.name ?? campaignId,
      channel_type: row.campaign?.advertisingChannelType ?? null,
      stat_date: date,
      impressions: num(row.metrics?.impressions),
      clicks: num(row.metrics?.clicks),
      cost_micros: num(row.metrics?.costMicros),
      conversions: num(row.metrics?.conversions),
      conversions_value: num(row.metrics?.conversionsValue),
    });
  }

  // ---- 2. sitelinks and callouts ---------------------------------------
  try {
    const campaignRows = await readCampaignAssets(access, start, end);
    for (const row of campaignRows) {
      rememberAsset(row);
      const assetId = row.asset?.id;
      const fieldType = row.campaignAsset?.fieldType;
      const campaignId = row.campaign?.id;
      const date = row.segments?.date;
      if (!assetId || !fieldType || !campaignId || !date) continue;
      metrics.push({
        asset_id: assetId,
        field_type: fieldType,
        surface: "campaign_asset",
        campaign_id: campaignId,
        campaign_name: row.campaign?.name ?? campaignId,
        channel_type: row.campaign?.advertisingChannelType ?? null,
        stat_date: date,
        impressions: num(row.metrics?.impressions),
        clicks: num(row.metrics?.clicks),
        cost_micros: num(row.metrics?.costMicros),
        conversions: num(row.metrics?.conversions),
        conversions_value: num(row.metrics?.conversionsValue),
      });
      placements.push({
        asset_id: assetId,
        container: "campaign",
        container_id: campaignId,
        container_name: row.campaign?.name ?? null,
        campaign_id: campaignId,
        campaign_name: row.campaign?.name ?? null,
        field_type: fieldType,
        status: row.campaignAsset?.status ?? null,
        synced_at: syncedAt,
      });
    }
  } catch (error) {
    // Extensions are a bonus lane. Losing them should not cost the headlines.
    warnings.push(
      `campaign_asset: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // ---- 3. Performance Max inventory ------------------------------------
  try {
    const assetGroupRows = await readAssetGroupAssets(access);
    for (const row of assetGroupRows) {
      rememberAsset(row);
      const assetId = row.asset?.id;
      const fieldType = row.assetGroupAsset?.fieldType;
      const groupId = row.assetGroup?.id;
      if (!assetId || !fieldType || !groupId) continue;
      placements.push({
        asset_id: assetId,
        container: "asset_group",
        container_id: groupId,
        container_name: row.assetGroup?.name ?? null,
        campaign_id: row.campaign?.id ?? null,
        campaign_name: row.campaign?.name ?? null,
        field_type: fieldType,
        status: row.assetGroupAsset?.status ?? null,
        synced_at: syncedAt,
      });
    }
  } catch (error) {
    warnings.push(
      `asset_group_asset: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // ---- write -----------------------------------------------------------
  const assetRows = [...assets.values()];
  for (const batch of chunk(assetRows, UPSERT_BATCH)) {
    const { error } = await supabase
      .from("dashboard_ad_assets")
      .upsert(batch, { onConflict: "asset_id" });
    if (error) {
      return { ok: false, syncedAt, start, end, error: `assets: ${error.message}` };
    }
  }

  const foldedMetrics = foldMetrics(metrics);
  for (const batch of chunk(foldedMetrics, UPSERT_BATCH)) {
    const { error } = await supabase
      .from("dashboard_ad_asset_metrics")
      .upsert(batch, {
        onConflict: "asset_id,field_type,surface,campaign_id,stat_date",
      });
    if (error) {
      return { ok: false, syncedAt, start, end, error: `metrics: ${error.message}` };
    }
  }

  // Placements describe the account as it stands now, so a stale row is a lie
  // rather than history. Deduplicate before writing: the same asset can be
  // attached to one campaign on many days, which the daily campaign_asset read
  // surfaces repeatedly, and upserting duplicates inside one statement is an
  // error in Postgres rather than a silent last-write-wins.
  const uniquePlacements = new Map<string, PlacementRecord>();
  for (const placement of placements) {
    uniquePlacements.set(
      [
        placement.asset_id,
        placement.container,
        placement.container_id,
        placement.field_type,
      ].join("|"),
      placement,
    );
  }
  const placementRows = [...uniquePlacements.values()];
  for (const batch of chunk(placementRows, UPSERT_BATCH)) {
    const { error } = await supabase
      .from("dashboard_ad_asset_placements")
      .upsert(batch, {
        onConflict: "asset_id,container,container_id,field_type",
      });
    if (error) {
      return { ok: false, syncedAt, start, end, error: `placements: ${error.message}` };
    }
  }

  return {
    ok: true,
    syncedAt,
    start,
    end,
    assets: assetRows.length,
    metricRows: foldedMetrics.length,
    placements: placementRows.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
