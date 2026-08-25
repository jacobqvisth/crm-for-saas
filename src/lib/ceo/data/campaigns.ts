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
  RECENT_SERVING_DAYS,
  isTabbed,
  normalizeCampaignName,
  type CampaignDetail,
  type CampaignPerformance,
  type CampaignsData,
  type CampaignsKpis,
  type CatalogCampaign,
  type DailyPoint,
  type MonthlyPoint,
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

// dashboard_user_attribution has no signup date, only synced_at (when the row
// was written, which is meaningless as a cohort). To place a user in the month
// they actually arrived we have to join to dashboard_users.signed_up_at.
type UserSignupRow = {
  internal_user_id: string | null;
  signed_up_at: string | null;
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

/** Daily series for one campaign, ascending by date, zero-days omitted. */
function buildDaily(rows: SnapshotRow[], campaign: string): DailyPoint[] {
  const byDay = new Map<string, Totals>();
  for (const row of rows) {
    if (campaignNameOf(row) !== campaign) continue;
    const day = row.period_start.slice(0, 10);
    let totals = byDay.get(day);
    if (!totals) {
      totals = emptyTotals();
      byDay.set(day, totals);
    }
    accumulate(totals, row);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, t]) => ({
      date,
      spendSek: t.spendUsd * USD_TO_SEK,
      clicks: t.clicks,
      impressions: t.impressions,
    }));
}

/** Monthly series for one campaign, with the users it acquired that month. */
function buildMonthly(
  rows: SnapshotRow[],
  campaign: string,
  usersByCampaignMonth: Map<string, number>,
): MonthlyPoint[] {
  const byMonth = new Map<string, Totals>();
  for (const row of rows) {
    if (campaignNameOf(row) !== campaign) continue;
    const month = row.period_start.slice(0, 7);
    let totals = byMonth.get(month);
    if (!totals) {
      totals = emptyTotals();
      byMonth.set(month, totals);
    }
    accumulate(totals, row);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, t]) => ({
      month,
      spendSek: t.spendUsd * USD_TO_SEK,
      clicks: t.clicks,
      impressions: t.impressions,
      users: usersByCampaignMonth.get(`${campaign.toLowerCase()}|${month}`) ?? 0,
    }));
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
    details: CAMPAIGN_CATALOG.filter(isTabbed).map((catalog) => ({
      catalog,
      performance: null,
      daily: [],
      monthly: [],
      spendSharePct: null,
      statusDiscrepancy: null,
      lowDeliveryWarning: null,
    })),
  };
}

async function getCampaignsDataUncached(): Promise<CampaignsData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData();

  const [snapshotsRes, attributionRes, usersRes] = await Promise.all([
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
    pageAll<UserSignupRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, signed_up_at")
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
  // Keyed "campaign|YYYY-MM", so a campaign tab can chart users arriving over
  // time rather than only a lifetime total.
  const usersByCampaignMonth = new Map<string, number>();

  if (!attributionRes.error) {
    const signupMonth = new Map<string, string>();
    if (!usersRes.error) {
      for (const row of usersRes.data ?? []) {
        if (!row.internal_user_id || !row.signed_up_at) continue;
        signupMonth.set(row.internal_user_id, row.signed_up_at.slice(0, 7));
      }
    }

    usersByCampaign = new Map<string, number>();
    for (const row of attributionRes.data ?? []) {
      const campaign = row.google_ads_campaign?.trim();
      if (!campaign) continue;
      const key = campaign.toLowerCase();
      usersByCampaign.set(key, (usersByCampaign.get(key) ?? 0) + 1);

      const month = row.internal_user_id
        ? signupMonth.get(row.internal_user_id)
        : undefined;
      if (month) {
        const monthKey = `${key}|${month}`;
        usersByCampaignMonth.set(
          monthKey,
          (usersByCampaignMonth.get(monthKey) ?? 0) + 1,
        );
      }
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

  // One detail entry per non-retired catalogued campaign, in catalog order.
  // Built even when GA4 has nothing for it: a paused campaign still has
  // structure, creative and keywords worth showing on its tab.
  const perfByName = new Map<string, CampaignPerformance>();
  for (const row of allTime) perfByName.set(row.name.toLowerCase(), row);

  const details: CampaignDetail[] = CAMPAIGN_CATALOG.filter(isTabbed).map(
    (catalog) => {
      const names = [catalog.name, ...(catalog.aliases ?? [])];
      let performance: CampaignPerformance | null = null;
      let matchedName: string | null = null;
      for (const n of names) {
        const hit = perfByName.get(n.toLowerCase());
        if (hit) {
          performance = hit;
          matchedName = hit.name;
          break;
        }
      }
      const daily = matchedName ? buildDaily(rows, matchedName) : [];

      // Did it serve in the last week? Measured against the newest day in the
      // dataset, not today, so a stalled sync does not read as a stopped
      // campaign.
      let recentImpressions = 0;
      let recentClicks = 0;
      if (latestDay) {
        const cutoff = new Date(`${latestDay}T00:00:00Z`);
        cutoff.setUTCDate(cutoff.getUTCDate() - (RECENT_SERVING_DAYS - 1));
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        for (const point of daily) {
          if (point.date >= cutoffStr) {
            recentImpressions += point.impressions;
            recentClicks += point.clicks;
          }
        }
      }

      let statusDiscrepancy: string | null = null;
      if (
        recentImpressions > 0 &&
        (catalog.status === "paused" || catalog.status === "planned")
      ) {
        statusDiscrepancy =
          `The catalog says "${catalog.status}", but GA4 recorded ` +
          `${recentImpressions} impressions in the last ${RECENT_SERVING_DAYS} days. ` +
          `Someone enabled this in Google Ads. Update the catalog.`;
      }

      let lowDeliveryWarning: string | null = null;
      if (recentImpressions > 0 && recentClicks === 0) {
        lowDeliveryWarning =
          `Serving but winning nothing: ${recentImpressions} impressions and ` +
          `0 clicks in the last ${RECENT_SERVING_DAYS} days. On this account ` +
          `that points at the max CPC being below the auction price, not at ` +
          `the keywords. The retired us-generic Search campaign paid about ` +
          `46 SEK per click.`;
      }

      return {
        catalog,
        performance,
        daily,
        monthly: matchedName
          ? buildMonthly(rows, matchedName, usersByCampaignMonth)
          : [],
        spendSharePct:
          performance && totalSpendSek > 0
            ? (performance.spendSek / totalSpendSek) * 100
            : null,
        statusDiscrepancy,
        lowDeliveryWarning,
      };
    },
  );

  return {
    kpis,
    allTime,
    windows,
    trend: buildTrend(rows),
    noDataCampaigns,
    attribution,
    details,
  };
}

export const getCampaignsData = unstable_cache(
  getCampaignsDataUncached,
  ["ceo-campaigns-data"],
  CEO_CACHE_OPTIONS,
);
