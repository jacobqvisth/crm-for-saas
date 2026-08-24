// Loader for /dashboard/campaigns.
//
// Joins the hand-curated campaign catalog (campaigns-shared.ts) against the
// only Google Ads performance data available: GA4's linked-Ads dimensions,
// synced hourly into dashboard_metric_snapshots by the google_ads source.
//
// Two structural facts drive the shape of this page:
//
//  1. GA4 only reports campaigns that actually SERVED. A paused campaign with
//     no impressions does not appear at all. So "not in the data" never means
//     "does not exist" — the catalog carries those, listed separately.
//  2. Spend arrives in USD (GA4 reports advertiserAdCost that way) while the
//     ad account bills in SEK. Everything user-facing here is SEK, converted
//     at the same fixed rate the CAC/LTV and Google Ads Users pages use so the
//     three pages never disagree.

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  CAMPAIGN_CATALOG,
  USD_TO_SEK,
  findCatalogEntry,
  normalizeCampaignName,
  type CampaignPerformance,
  type CampaignsData,
  type CampaignsKpis,
  type CatalogCampaign,
  type SpendTrendPoint,
  type WindowedPerformance,
} from "@/lib/ceo/campaigns-shared";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

type SnapshotRow = {
  metric_key: string;
  period_start: string;
  value: number | string | null;
  dimensions: Record<string, unknown> | null;
};

type AttributionRow = {
  internal_user_id: string | null;
  channel: string | null;
  google_ads_campaign: string | null;
};

type Totals = {
  spendUsd: number;
  clicks: number;
  impressions: number;
  firstDay: string | null;
  lastDay: string | null;
};

function emptyTotals(): Totals {
  return {
    spendUsd: 0,
    clicks: 0,
    impressions: 0,
    firstDay: null,
    lastDay: null,
  };
}

function num(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function campaignNameOf(row: SnapshotRow): string | null {
  return normalizeCampaignName(row.dimensions?.campaign);
}

function accumulate(into: Totals, row: SnapshotRow) {
  const value = num(row.value);
  if (row.metric_key === "ad_spend") into.spendUsd += value;
  else if (row.metric_key === "ad_clicks") into.clicks += value;
  else if (row.metric_key === "ad_impressions") into.impressions += value;

  const day = row.period_start.slice(0, 10);
  if (!into.firstDay || day < into.firstDay) into.firstDay = day;
  if (!into.lastDay || day > into.lastDay) into.lastDay = day;
}

function toPerformance(
  name: string,
  totals: Totals,
  usersByCampaign: Map<string, number> | null,
): CampaignPerformance {
  const spendSek = totals.spendUsd * USD_TO_SEK;
  const attributedUsers = usersByCampaign
    ? (usersByCampaign.get(name.toLowerCase()) ?? 0)
    : null;
  return {
    name,
    catalog: findCatalogEntry(name),
    spendSek,
    clicks: totals.clicks,
    impressions: totals.impressions,
    cpcSek: totals.clicks > 0 ? spendSek / totals.clicks : null,
    ctrPct:
      totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    firstDay: totals.firstDay,
    lastDay: totals.lastDay,
    attributedUsers,
    costPerUserSek:
      attributedUsers && attributedUsers > 0 ? spendSek / attributedUsers : null,
  };
}

function buildWindow(
  label: string,
  days: number | null,
  rows: SnapshotRow[],
  latestDay: string | null,
  usersByCampaign: Map<string, number> | null,
): WindowedPerformance {
  let cutoff: string | null = null;
  if (days !== null && latestDay) {
    const d = new Date(`${latestDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    cutoff = d.toISOString().slice(0, 10);
  }

  const byCampaign = new Map<string, Totals>();
  for (const row of rows) {
    const name = campaignNameOf(row);
    if (!name) continue;
    if (cutoff && row.period_start.slice(0, 10) < cutoff) continue;
    let totals = byCampaign.get(name);
    if (!totals) {
      totals = emptyTotals();
      byCampaign.set(name, totals);
    }
    accumulate(totals, row);
  }

  const perf = [...byCampaign.entries()]
    .map(([name, totals]) => toPerformance(name, totals, usersByCampaign))
    // Drop rows that saw literally nothing in the window, they add noise.
    .filter((r) => r.spendSek > 0 || r.clicks > 0 || r.impressions > 0)
    .sort((a, b) => b.spendSek - a.spendSek);

  return {
    label,
    days,
    rows: perf,
    totalSpendSek: perf.reduce((sum, r) => sum + r.spendSek, 0),
  };
}

function buildTrend(rows: SnapshotRow[]): SpendTrendPoint[] {
  const byMonth = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.metric_key !== "ad_spend") continue;
    const name = campaignNameOf(row);
    if (!name) continue;
    const month = row.period_start.slice(0, 7);
    let bucket = byMonth.get(month);
    if (!bucket) {
      bucket = new Map<string, number>();
      byMonth.set(month, bucket);
    }
    bucket.set(name, (bucket.get(name) ?? 0) + num(row.value) * USD_TO_SEK);
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, bucket]) => {
      const byCampaign: Record<string, number> = {};
      let totalSek = 0;
      for (const [name, spend] of bucket) {
        byCampaign[name] = spend;
        totalSek += spend;
      }
      return { month, byCampaign, totalSek };
    });
}

/**
 * Shape returned when Supabase is not configured (local dev without env).
 * The catalog still renders — it is static — so the page stays useful and
 * explains itself rather than erroring out.
 */
function emptyData(): CampaignsData {
  return {
    kpis: {
      totalSpendSek: 0,
      totalClicks: 0,
      totalImpressions: 0,
      blendedCpcSek: null,
      blendedCtrPct: null,
      liveCampaigns: CAMPAIGN_CATALOG.filter((c) => c.status === "live").length,
      pausedOrPlanned: CAMPAIGN_CATALOG.filter(
        (c) => c.status === "paused" || c.status === "planned",
      ).length,
      firstDay: null,
      lastDay: null,
    },
    allTime: [],
    windows: [],
    trend: [],
    noDataCampaigns: CAMPAIGN_CATALOG,
    attribution: null,
  };
}

async function getCampaignsDataUncached(): Promise<CampaignsData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData();

  const [snapshotsRes, attributionRes] = await Promise.all([
    pageAll<SnapshotRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("metric_key, period_start, value, dimensions")
        // Spend/clicks/impressions land one row per (campaign, day) with no
        // "total" dimension row, so we sum across campaigns rather than
        // filtering on dimension_key.
        .eq("source_key", "google_ads")
        .in("metric_key", ["ad_spend", "ad_clicks", "ad_impressions"])
        .order("id")
        .range(from, to),
    ),
    pageAll<AttributionRow>(({ from, to }) =>
      supabase
        .from(TABLES.userAttribution)
        // internal_user_id is the unique key here (the table has no `id`),
        // so it is the stable tiebreaker pageAll needs to avoid dupes/skips.
        .select("internal_user_id, channel, google_ads_campaign")
        .order("internal_user_id")
        .range(from, to),
    ),
  ]);

  if (snapshotsRes.error) {
    throw new Error(
      `Failed to load Google Ads snapshots: ${snapshotsRes.error.message}`,
    );
  }

  const rows = snapshotsRes.data ?? [];

  // Users whose GA4 first touch was a given campaign. Lifetime by nature:
  // first touch belongs to the user, not to a reporting window.
  let usersByCampaign: Map<string, number> | null = null;
  if (!attributionRes.error) {
    usersByCampaign = new Map<string, number>();
    for (const row of attributionRes.data ?? []) {
      const campaign = row.google_ads_campaign?.trim();
      if (!campaign) continue;
      const key = campaign.toLowerCase();
      usersByCampaign.set(key, (usersByCampaign.get(key) ?? 0) + 1);
    }
  }

  // All-time totals per campaign.
  const allTimeWindow = buildWindow("All time", null, rows, null, usersByCampaign);
  const allTime = allTimeWindow.rows;

  let latestDay: string | null = null;
  for (const row of rows) {
    const day = row.period_start.slice(0, 10);
    if (!latestDay || day > latestDay) latestDay = day;
  }
  let earliestDay: string | null = null;
  for (const row of rows) {
    const day = row.period_start.slice(0, 10);
    if (!earliestDay || day < earliestDay) earliestDay = day;
  }

  const windows: WindowedPerformance[] = [
    // Per-campaign user counts are lifetime, so they are deliberately NOT
    // passed into the shorter windows — showing a lifetime user count next to
    // 30 days of spend would invite a false cost-per-user reading.
    buildWindow("Last 30 days", 30, rows, latestDay, null),
    buildWindow("Last 90 days", 90, rows, latestDay, null),
    allTimeWindow,
  ];

  const totalSpendSek = allTime.reduce((sum, r) => sum + r.spendSek, 0);
  const totalClicks = allTime.reduce((sum, r) => sum + r.clicks, 0);
  const totalImpressions = allTime.reduce((sum, r) => sum + r.impressions, 0);

  const seen = new Set(allTime.map((r) => r.name.toLowerCase()));
  const noDataCampaigns: CatalogCampaign[] = CAMPAIGN_CATALOG.filter((c) => {
    const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase());
    return !names.some((n) => seen.has(n));
  });

  const kpis: CampaignsKpis = {
    totalSpendSek,
    totalClicks,
    totalImpressions,
    blendedCpcSek: totalClicks > 0 ? totalSpendSek / totalClicks : null,
    blendedCtrPct:
      totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null,
    liveCampaigns: CAMPAIGN_CATALOG.filter((c) => c.status === "live").length,
    pausedOrPlanned: CAMPAIGN_CATALOG.filter(
      (c) => c.status === "paused" || c.status === "planned",
    ).length,
    firstDay: earliestDay,
    lastDay: latestDay,
  };

  let attribution: CampaignsData["attribution"] = null;
  if (!attributionRes.error) {
    const attrRows = attributionRes.data ?? [];
    const total = attrRows.length;
    const ads = attrRows.filter((r) => r.channel === "google_ads").length;
    if (total > 0) {
      attribution = {
        googleAdsUsers: ads,
        totalAttributedUsers: total,
        googleAdsSharePct: (ads / total) * 100,
      };
    }
  }

  return {
    kpis,
    allTime,
    windows,
    trend: buildTrend(rows),
    noDataCampaigns,
    attribution,
  };
}

export const getCampaignsData = unstable_cache(
  getCampaignsDataUncached,
  ["ceo-campaigns-data"],
  CEO_CACHE_OPTIONS,
);
