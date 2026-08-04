import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import type { ResolvedDashboardRange } from "@/lib/ceo/time-ranges";

// Raw shape returned by public.get_organic_analysis (see the migration for why
// this is an RPC and not a table read). Numerics come back from PostgREST as
// strings often enough that everything gets coerced through `num()`.
type RawDaily = {
  date: string;
  clicks: number | string;
  impressions: number | string;
  position: number | string;
};
type RawDailyHost = {
  date: string;
  host: string;
  clicks: number | string;
  impressions: number | string;
};
type RawMonthlyHost = RawDailyHost & {
  month: string;
  pages: number | string;
};
type RawBranded = {
  month: string;
  branded_clicks: number | string;
  branded_impressions: number | string;
  nonbranded_clicks: number | string;
  nonbranded_impressions: number | string;
};
type RawBucket = {
  bucket: string;
  impressions: number | string;
  clicks: number | string;
};
type RawQuery = {
  query: string;
  impressions: number | string;
  clicks: number | string;
  position: number | string;
};
type RawCountry = {
  country: string;
  impressions: number | string;
  clicks: number | string;
  ctr: number | string;
};
type RawPage = RawCountry & { page: string; host: string; position: number | string };

type RawAnalysis = {
  generated_at: string;
  daily: RawDaily[];
  daily_by_host: RawDailyHost[];
  monthly_by_host: RawMonthlyHost[];
  branded_monthly: RawBranded[];
  position_buckets: RawBucket[];
  zero_click: RawQuery[];
  page_two: RawQuery[];
  countries: RawCountry[];
  top_pages: RawPage[];
};

export type OrganicDailyPoint = {
  date: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type OrganicHostSeries = {
  host: string;
  clicks: number;
  impressions: number;
  ctr: number;
  /** Impression share of the whole property in range. */
  share: number;
  /** Impressions/day averaged over the first vs last third of the range. */
  startRate: number;
  endRate: number;
  /** Percent change from startRate to endRate. Negative means shrinking. */
  changePct: number | null;
  points: { date: string; clicks: number; impressions: number }[];
};

export type OrganicCliff = {
  host: string;
  /** First day of the sustained lower level. */
  date: string;
  beforeRate: number;
  afterRate: number;
  dropPct: number;
};

export type OrganicMonthlyHostRow = {
  month: string;
  host: string;
  clicks: number;
  impressions: number;
  pages: number;
};

export type OrganicBrandedRow = {
  month: string;
  brandedClicks: number;
  brandedImpressions: number;
  nonbrandedClicks: number;
  nonbrandedImpressions: number;
};

export type OrganicBucketRow = {
  bucket: string;
  impressions: number;
  clicks: number;
  ctr: number;
  share: number;
};

export type OrganicQueryRow = {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
};

export type OrganicCountryRow = {
  country: string;
  impressions: number;
  clicks: number;
  ctr: number;
};

export type OrganicPageRow = {
  page: string;
  host: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
};

export type OrganicFindingSeverity = "critical" | "warning" | "info" | "good";

export type OrganicFinding = {
  severity: OrganicFindingSeverity;
  title: string;
  detail: string;
  /** Where to look next. Kept short — this renders as one line. */
  action?: string;
};

export type OrganicAnalysisTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type OrganicAnalysisData = {
  generatedAt: string;
  rangeLabel: string;
  rangeSpan: string;
  totals: OrganicAnalysisTotals;
  previousTotals: OrganicAnalysisTotals | null;
  daily: OrganicDailyPoint[];
  hosts: OrganicHostSeries[];
  cliffs: OrganicCliff[];
  monthlyByHost: OrganicMonthlyHostRow[];
  branded: OrganicBrandedRow[];
  buckets: OrganicBucketRow[];
  zeroClick: OrganicQueryRow[];
  pageTwo: OrganicQueryRow[];
  countries: OrganicCountryRow[];
  topPages: OrganicPageRow[];
  findings: OrganicFinding[];
  error?: string;
};

function num(value: number | string | null | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratePerDay(points: { impressions: number }[]): number {
  if (points.length === 0) return 0;
  const total = points.reduce((sum, point) => sum + point.impressions, 0);
  return total / points.length;
}

function pctChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

/**
 * Drop the trailing month when it is still in progress.
 *
 * Month-over-month comparisons are otherwise nonsense at the start of a month:
 * three days of August against all of July reads as a ~95% collapse in every
 * metric. Callers pass rows already sorted ascending by month.
 */
function completedMonths<T extends { month: string }>(rows: T[]): T[] {
  if (rows.length < 2) return rows;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const last = rows[rows.length - 1]!;

  return last.month.slice(0, 7) === currentMonth ? rows.slice(0, -1) : rows;
}

/**
 * Find a step change in a daily impressions series.
 *
 * A subdomain being demoted looks nothing like a slow decline: impressions
 * hold a level, then drop to a new level within a day or two and stay there.
 * Comparing a trailing 7-day mean to a leading 7-day mean at every candidate
 * day surfaces exactly that shape, and the "stay there" part is what stops a
 * single quiet weekend from registering.
 *
 * Returns the largest qualifying drop, or null when the series is too short,
 * too small, or merely noisy.
 */
export function detectCliff(
  host: string,
  points: { date: string; impressions: number }[],
): OrganicCliff | null {
  const WINDOW = 7;
  const MIN_BEFORE_RATE = 100; // ignore hosts that were never material
  const MIN_DROP_PCT = 50;

  if (points.length < WINDOW * 2) return null;

  let best: OrganicCliff | null = null;

  for (let i = WINDOW; i <= points.length - WINDOW; i += 1) {
    const before = points.slice(i - WINDOW, i);
    const after = points.slice(i, i + WINDOW);
    const beforeRate = ratePerDay(before);
    const afterRate = ratePerDay(after);

    if (beforeRate < MIN_BEFORE_RATE) continue;

    const dropPct = ((beforeRate - afterRate) / beforeRate) * 100;
    if (dropPct < MIN_DROP_PCT) continue;

    if (!best || dropPct > best.dropPct) {
      best = {
        host,
        date: points[i]!.date,
        beforeRate,
        afterRate,
        dropPct,
      };
    }
  }

  return best;
}

function buildHostSeries(rows: RawDailyHost[]): OrganicHostSeries[] {
  const byHost = new Map<string, { date: string; clicks: number; impressions: number }[]>();

  for (const row of rows) {
    const host = row.host;
    if (!host) continue;
    const list = byHost.get(host) ?? [];
    list.push({
      date: row.date,
      clicks: num(row.clicks),
      impressions: num(row.impressions),
    });
    byHost.set(host, list);
  }

  const totalImpressions = rows.reduce((sum, row) => sum + num(row.impressions), 0);

  return [...byHost.entries()]
    .map(([host, points]) => {
      points.sort((a, b) => a.date.localeCompare(b.date));
      const clicks = points.reduce((sum, point) => sum + point.clicks, 0);
      const impressions = points.reduce((sum, point) => sum + point.impressions, 0);
      // Thirds rather than halves: the middle third absorbs the transition so
      // the comparison contrasts two settled levels.
      const third = Math.max(1, Math.floor(points.length / 3));
      const startRate = ratePerDay(points.slice(0, third));
      const endRate = ratePerDay(points.slice(-third));

      return {
        host,
        clicks,
        impressions,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        share: totalImpressions > 0 ? (impressions / totalImpressions) * 100 : 0,
        startRate,
        endRate,
        changePct: pctChange(startRate, endRate),
        points,
      };
    })
    .sort((a, b) => b.impressions - a.impressions);
}

export function buildFindings({
  totals,
  hosts,
  cliffs,
  buckets,
  branded,
  monthlyByHost,
  zeroClick,
  countries,
  pageTwo,
}: {
  totals: OrganicAnalysisTotals;
  hosts: OrganicHostSeries[];
  cliffs: OrganicCliff[];
  buckets: OrganicBucketRow[];
  branded: OrganicBrandedRow[];
  monthlyByHost: OrganicMonthlyHostRow[];
  zeroClick: OrganicQueryRow[];
  countries: OrganicCountryRow[];
  pageTwo: OrganicQueryRow[];
}): OrganicFinding[] {
  const findings: OrganicFinding[] = [];

  // 1. Step changes per host. The single most actionable signal on this page.
  for (const cliff of cliffs) {
    findings.push({
      severity: "critical",
      title: `${cliff.host} dropped ${cliff.dropPct.toFixed(0)}% on ${cliff.date}`,
      detail:
        `Impressions fell from about ${Math.round(cliff.beforeRate).toLocaleString("en-US")}/day ` +
        `to about ${Math.round(cliff.afterRate).toLocaleString("en-US")}/day and stayed there. ` +
        `A step change of this shape is a ranking or indexing event, not seasonality.`,
      action:
        "Check Search Console > Manual Actions and Page Indexing for this property, then confirm robots.txt, noindex and canonical on a sample URL.",
    });
  }

  // 2. Hosts shrinking without a clean cliff.
  for (const host of hosts) {
    if (cliffs.some((cliff) => cliff.host === host.host)) continue;
    if (host.impressions < 500) continue;
    if (host.changePct !== null && host.changePct <= -25) {
      findings.push({
        severity: "warning",
        title: `${host.host} is trending down ${Math.abs(host.changePct).toFixed(0)}%`,
        detail:
          `Daily impressions went from about ${Math.round(host.startRate).toLocaleString("en-US")} ` +
          `to about ${Math.round(host.endRate).toLocaleString("en-US")} across the range, with no single-day cliff. ` +
          `That pattern is gradual ranking loss rather than a penalty.`,
        action: "Compare the page table below against the previous period to see which URLs gave up ground.",
      });
    } else if (host.changePct !== null && host.changePct >= 25) {
      findings.push({
        severity: "good",
        title: `${host.host} is growing ${host.changePct.toFixed(0)}%`,
        detail:
          `Daily impressions rose from about ${Math.round(host.startRate).toLocaleString("en-US")} ` +
          `to about ${Math.round(host.endRate).toLocaleString("en-US")}.`,
      });
    }
  }

  // 3. Where the impressions actually sit on the SERP. Page-2 impressions
  //    look like reach in a totals chart but cannot convert.
  const totalBucketImpressions = buckets.reduce((sum, b) => sum + b.impressions, 0);
  const deep = buckets
    .filter((bucket) => bucket.bucket === "11-20" || bucket.bucket === "21+")
    .reduce((sum, bucket) => sum + bucket.impressions, 0);
  if (totalBucketImpressions > 0) {
    const deepShare = (deep / totalBucketImpressions) * 100;
    if (deepShare >= 50) {
      findings.push({
        severity: "warning",
        title: `${deepShare.toFixed(0)}% of impressions rank below position 10`,
        detail:
          `Most of the visible reach is on page 2 or worse, which is why sitewide CTR reads ` +
          `${totals.ctr.toFixed(2)}%. Impression growth from this pool does not convert into clicks.`,
        action: "Work the page-2 query list below: those need the smallest ranking move to start earning clicks.",
      });
    }
  }

  // 4. Brand vs non-brand. Brand is demand you already have; growth has to
  //    come from non-branded, and a falling brand line is its own warning.
  const brandedMonths = completedMonths(branded);
  if (brandedMonths.length >= 2) {
    const first = brandedMonths[0]!;
    const last = brandedMonths[brandedMonths.length - 1]!;
    const brandChange = pctChange(first.brandedClicks, last.brandedClicks);
    const totalClicks = last.brandedClicks + last.nonbrandedClicks;
    const brandShare = totalClicks > 0 ? (last.brandedClicks / totalClicks) * 100 : 0;

    if (brandShare >= 50) {
      findings.push({
        severity: "info",
        title: `Branded search is ${brandShare.toFixed(0)}% of clicks`,
        detail:
          `Most organic clicks come from people already searching the brand name. ` +
          `Non-branded is the only part that represents new discovery.`,
        action: "Judge SEO progress on the non-branded line, not total clicks.",
      });
    }
    if (brandChange !== null && brandChange <= -25) {
      findings.push({
        severity: "warning",
        title: `Branded clicks are down ${Math.abs(brandChange).toFixed(0)}%`,
        detail:
          `Brand search went from ${first.brandedClicks.toLocaleString("en-US")} to ` +
          `${last.brandedClicks.toLocaleString("en-US")} clicks per month. Brand demand usually ` +
          `tracks overall awareness rather than anything on-page.`,
      });
    }
  }

  // 5. Content velocity. Impressions can look flat while the number of URLs
  //    earning them quietly shrinks, which is a leading indicator.
  const monthsByHost = new Map<string, OrganicMonthlyHostRow[]>();
  for (const row of monthlyByHost) {
    const list = monthsByHost.get(row.host) ?? [];
    list.push(row);
    monthsByHost.set(row.host, list);
  }
  for (const [host, rows] of monthsByHost) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.month.localeCompare(b.month));
    const usable = completedMonths(rows);
    if (usable.length < 2) continue;
    const first = usable[0]!;
    const last = usable[usable.length - 1]!;
    if (first.pages < 20) continue;
    const change = pctChange(first.pages, last.pages);
    if (change !== null && change <= -15) {
      findings.push({
        severity: "warning",
        title: `${host} is earning impressions on ${Math.abs(change).toFixed(0)}% fewer pages`,
        detail:
          `Pages with any impressions fell from ${first.pages} in ${first.month} to ${last.pages} in ${last.month}. ` +
          `Fewer ranking URLs means the catalogue is losing coverage even if total impressions look steady.`,
        action: "Either the content is thinning or new pages are not getting indexed. Check publish cadence against index coverage.",
      });
    }
  }

  // 6. Zero-click demand.
  const zeroClickImpressions = zeroClick.reduce((sum, row) => sum + row.impressions, 0);
  if (zeroClickImpressions > 0 && totals.impressions > 0) {
    const share = (zeroClickImpressions / totals.impressions) * 100;
    if (share >= 5) {
      findings.push({
        severity: "info",
        title: `${zeroClickImpressions.toLocaleString("en-US")} impressions produced zero clicks`,
        detail:
          `The top ${zeroClick.length} zero-click queries alone are ${share.toFixed(0)}% of all impressions. ` +
          `These are typically definition-style questions that Google answers directly in the results page.`,
        action: "Chase queries with buying or troubleshooting intent instead of definitional ones.",
      });
    }
  }

  // 7. Geography vs ICP. High volume at low CTR from a market you do not sell
  //    into is worse than no traffic: it inflates every average on the page.
  const ranked = [...countries].sort((a, b) => b.impressions - a.impressions);
  const top = ranked[0];
  if (top && top.impressions >= 1000 && top.ctr < 0.5) {
    const best = [...countries]
      .filter((row) => row.impressions >= 200)
      .sort((a, b) => b.ctr - a.ctr)[0];
    findings.push({
      severity: "warning",
      title: `${top.country} is the biggest market but converts at ${top.ctr.toFixed(2)}%`,
      detail:
        `${top.country} contributes ${top.impressions.toLocaleString("en-US")} impressions for only ` +
        `${top.clicks.toLocaleString("en-US")} clicks` +
        (best && best.country !== top.country
          ? `, while ${best.country} converts at ${best.ctr.toFixed(2)}% on ${best.impressions.toLocaleString("en-US")} impressions.`
          : `.`) +
        ` Volume is landing where the intent is weakest.`,
      action: "Weight content toward the markets that actually click.",
    });
  }

  // 8. Upside, so the page ends on something to do rather than only problems.
  if (pageTwo.length > 0) {
    const upside = pageTwo.reduce((sum, row) => sum + row.impressions, 0);
    findings.push({
      severity: "info",
      title: `${pageTwo.length} queries sit just off page 1`,
      detail:
        `They already draw ${upside.toLocaleString("en-US")} impressions at positions 11-20. ` +
        `Moving them a few places is cheaper than ranking anything new.`,
      action: "Start with the highest-impression rows in the page-2 table.",
    });
  }

  const order: Record<OrganicFindingSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    good: 3,
  };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

const EMPTY_TOTALS: OrganicAnalysisTotals = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
};

function emptyData(
  rangeLabel: string,
  rangeSpan: string,
  error?: string,
): OrganicAnalysisData {
  return {
    generatedAt: new Date().toISOString(),
    rangeLabel,
    rangeSpan,
    totals: EMPTY_TOTALS,
    previousTotals: null,
    daily: [],
    hosts: [],
    cliffs: [],
    monthlyByHost: [],
    branded: [],
    buckets: [],
    zeroClick: [],
    pageTwo: [],
    countries: [],
    topPages: [],
    findings: [],
    error,
  };
}

function totalsFromDaily(daily: OrganicDailyPoint[]): OrganicAnalysisTotals {
  const clicks = daily.reduce((sum, point) => sum + point.clicks, 0);
  const impressions = daily.reduce((sum, point) => sum + point.impressions, 0);
  // Position is impression-weighted so quiet days cannot swing the average.
  const weighted = daily.reduce(
    (sum, point) => sum + point.position * point.impressions,
    0,
  );

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

function mapQueries(rows: RawQuery[]): OrganicQueryRow[] {
  return rows.map((row) => ({
    query: row.query,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    position: num(row.position),
  }));
}

async function getOrganicAnalysisUncached(
  rangeKey: string,
  rangeLabel: string,
  rangeSpan: string,
  startIso: string | null,
  endIso: string,
): Promise<OrganicAnalysisData> {
  void rangeKey; // part of the cache key only
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyData(rangeLabel, rangeSpan, "Supabase is not configured.");
  }

  // The comparison window is the same length immediately before the range, so
  // "is this better or worse than before" has a defensible denominator.
  let prevStartIso: string | null = null;
  let prevEndIso: string | null = null;
  if (startIso) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const span = end - start;
    if (span > 0) {
      prevStartIso = new Date(start - span).toISOString();
      prevEndIso = startIso;
    }
  }

  const [current, previous] = await Promise.all([
    supabase.rpc("get_organic_analysis", {
      p_start: startIso,
      p_end: endIso,
    }),
    prevStartIso && prevEndIso
      ? supabase.rpc("get_organic_analysis", {
          p_start: prevStartIso,
          p_end: prevEndIso,
        })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (current.error) {
    console.error("[ceo/organic-analysis] rpc failed", current.error);
    return emptyData(rangeLabel, rangeSpan, current.error.message);
  }

  const raw = current.data as RawAnalysis | null;
  if (!raw) {
    return emptyData(rangeLabel, rangeSpan);
  }

  const daily: OrganicDailyPoint[] = (raw.daily ?? []).map((row) => ({
    date: row.date,
    clicks: num(row.clicks),
    impressions: num(row.impressions),
    position: num(row.position),
  }));

  const hosts = buildHostSeries(raw.daily_by_host ?? []);
  const cliffs = hosts
    .map((host) => detectCliff(host.host, host.points))
    .filter((cliff): cliff is OrganicCliff => cliff !== null)
    .sort((a, b) => b.dropPct - a.dropPct);

  const monthlyByHost: OrganicMonthlyHostRow[] = (raw.monthly_by_host ?? []).map(
    (row) => ({
      month: row.month,
      host: row.host,
      clicks: num(row.clicks),
      impressions: num(row.impressions),
      pages: num(row.pages),
    }),
  );

  const branded: OrganicBrandedRow[] = (raw.branded_monthly ?? []).map((row) => ({
    month: row.month,
    brandedClicks: num(row.branded_clicks),
    brandedImpressions: num(row.branded_impressions),
    nonbrandedClicks: num(row.nonbranded_clicks),
    nonbrandedImpressions: num(row.nonbranded_impressions),
  }));

  const bucketRows = (raw.position_buckets ?? []).map((row) => ({
    bucket: row.bucket,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
  }));
  const bucketTotal = bucketRows.reduce((sum, row) => sum + row.impressions, 0);
  const buckets: OrganicBucketRow[] = bucketRows.map((row) => ({
    ...row,
    ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
    share: bucketTotal > 0 ? (row.impressions / bucketTotal) * 100 : 0,
  }));

  const countries: OrganicCountryRow[] = (raw.countries ?? []).map((row) => ({
    country: row.country,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
  }));

  const topPages: OrganicPageRow[] = (raw.top_pages ?? []).map((row) => ({
    page: row.page,
    host: row.host,
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
    position: num(row.position),
  }));

  const zeroClick = mapQueries(raw.zero_click ?? []);
  const pageTwo = mapQueries(raw.page_two ?? []);
  const totals = totalsFromDaily(daily);

  let previousTotals: OrganicAnalysisTotals | null = null;
  const prevRaw = previous?.data as RawAnalysis | null;
  if (prevRaw?.daily?.length) {
    previousTotals = totalsFromDaily(
      prevRaw.daily.map((row) => ({
        date: row.date,
        clicks: num(row.clicks),
        impressions: num(row.impressions),
        position: num(row.position),
      })),
    );
  }

  return {
    generatedAt: raw.generated_at ?? new Date().toISOString(),
    rangeLabel,
    rangeSpan,
    totals,
    previousTotals,
    daily,
    hosts,
    cliffs,
    monthlyByHost,
    branded,
    buckets,
    zeroClick,
    pageTwo,
    countries,
    topPages,
    findings: buildFindings({
      totals,
      hosts,
      cliffs,
      buckets,
      branded,
      monthlyByHost,
      zeroClick,
      countries,
      pageTwo,
    }),
  };
}

const cached = unstable_cache(
  getOrganicAnalysisUncached,
  ["ceo-organic-analysis-v1"],
  CEO_CACHE_OPTIONS,
);

export function getOrganicAnalysisData(
  range: ResolvedDashboardRange,
  rangeSpan: string,
): Promise<OrganicAnalysisData> {
  return cached(
    range.key,
    range.label,
    rangeSpan,
    range.start ? range.start.toISOString() : null,
    range.end.toISOString(),
  );
}
