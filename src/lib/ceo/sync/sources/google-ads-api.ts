import {
  EU_GEO_TARGETS,
  KEYWORD_CLUSTER_BY_TERM,
  KEYWORD_SEEDS,
} from "@/config/ceo/keyword-seeds";
import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import {
  createGoogleAdsAccess,
  googleAdsRequest,
  googleAdsSearch,
  GoogleAdsApiError,
  microsToUnits,
  type GoogleAdsAccess,
} from "@/lib/ceo/sync/google-ads-client";
import type {
  MetricPoint,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
} from "../types";

/**
 * Google Ads API connector.
 *
 * Distinct from the `google_ads` source, which reads GA4's `advertiserAdCost`
 * dimensions and therefore knows spend but not a single search term. This one
 * talks to the Ads API directly and answers two questions that one cannot:
 *
 *   1. Market demand    how many people search a term, independent of us
 *   2. Paid search terms which queries actually triggered our ads
 *
 * The two need different token access levels, which is why each report degrades
 * on its own:
 *
 *   - Keyword Planner (reports 1) needs **Basic** access with the "Researching
 *     keywords and recommendations" permissible use. An Explorer token reaches
 *     production accounts but is refused these services.
 *   - Reporting (reports 2 and 3) works at **Explorer** level.
 *
 * So a fresh Explorer token makes the search-term reports work while keyword
 * volumes record a warning. Both land once Basic is granted, with no code change.
 *
 * NOTE: written against the documented REST surface but not yet exercised
 * against a live account, because no developer token existed at the time. The
 * pure response-shaping is unit tested in google-ads-api.test.ts; the request
 * paths and error classification are the parts to watch on the first real run.
 */

const SOURCE_KEY = "google_ads_api" as const;

/** Keyword Planner accepts a large batch; stay well under it to be polite. */
const KEYWORD_CHUNK_SIZE = 500;

/** `generateKeywordIdeas` caps a keyword seed at 20 terms. */
const IDEA_SEED_CHUNK_SIZE = 20;

type KeywordMetrics = {
  avgMonthlySearches?: string | number | null;
  competition?: string | null;
  competitionIndex?: string | number | null;
  lowTopOfPageBidMicros?: string | number | null;
  highTopOfPageBidMicros?: string | number | null;
  monthlySearchVolumes?: {
    year?: string;
    month?: string;
    monthlySearches?: string;
  }[];
};

type HistoricalMetricsResult = {
  text?: string;
  keywordMetrics?: KeywordMetrics | null;
};

type KeywordIdeaResult = {
  text?: string;
  keywordIdeaMetrics?: KeywordMetrics | null;
};

type SearchTermRow = {
  searchTermView?: { searchTerm?: string };
  segments?: { date?: string };
  campaign?: { name?: string; id?: string; advertisingChannelType?: string };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number | string;
  };
};

type CampaignRow = {
  campaign?: { id?: string; name?: string; advertisingChannelType?: string };
};

type SearchTermInsightRow = {
  campaignSearchTermInsight?: {
    id?: string;
    categoryLabel?: string;
  };
  metrics?: {
    impressions?: string;
    clicks?: string;
    conversions?: number | string;
  };
};

function num(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Keyword volume is a monthly figure, so stamp it on the calendar month
 * containing the window end rather than the sync window. That way repeated syncs
 * in a month upsert the same row (the unique key includes the period), and the
 * table accumulates one clean point per keyword per month over time.
 */
export function monthPeriod(window: SourceSyncWindow) {
  const end = addUtcDays(window.end, -1);
  const year = end.getUTCFullYear();
  const month = end.getUTCMonth();

  return {
    periodStart: new Date(Date.UTC(year, month, 1)),
    periodEnd: new Date(Date.UTC(month === 11 ? year + 1 : year, (month + 1) % 12, 1)),
  };
}

function dayPeriod(date: string) {
  const periodStart = new Date(`${date}T00:00:00.000Z`);
  return { periodStart, periodEnd: addUtcDays(periodStart, 1) };
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function resolveGeoTargets() {
  const override = getEnv("GOOGLE_ADS_GEO_TARGETS");
  if (!override) {
    return EU_GEO_TARGETS;
  }

  return override
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      country: EU_GEO_TARGETS.find((geo) => geo.id === id)?.country ?? id,
    }));
}

export function keywordMetricPoints(
  results: HistoricalMetricsResult[],
  country: string,
  period: { periodStart: Date; periodEnd: Date },
): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const result of results) {
    const keyword = result.text?.trim().toLowerCase();
    if (!keyword) continue;

    const m = result.keywordMetrics;
    if (!m) continue;

    const dimensions = {
      keyword,
      country,
      cluster: KEYWORD_CLUSTER_BY_TERM[keyword] ?? "discovered",
    };

    const base = {
      sourceKey: SOURCE_KEY,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dimensions,
    };

    metrics.push({
      ...base,
      metricKey: "keyword_avg_monthly_searches",
      value: num(m.avgMonthlySearches),
    });

    if (m.competitionIndex !== undefined && m.competitionIndex !== null) {
      metrics.push({
        ...base,
        metricKey: "keyword_competition_index",
        value: num(m.competitionIndex),
      });
    }

    if (m.lowTopOfPageBidMicros !== undefined && m.lowTopOfPageBidMicros !== null) {
      metrics.push({
        ...base,
        metricKey: "keyword_top_of_page_bid_low",
        value: microsToUnits(m.lowTopOfPageBidMicros),
        unit: "currency",
      });
    }

    if (m.highTopOfPageBidMicros !== undefined && m.highTopOfPageBidMicros !== null) {
      metrics.push({
        ...base,
        metricKey: "keyword_top_of_page_bid_high",
        value: microsToUnits(m.highTopOfPageBidMicros),
        unit: "currency",
      });
    }
  }

  return metrics;
}

export function searchTermMetricPoints(rows: SearchTermRow[]): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const row of rows) {
    const term = row.searchTermView?.searchTerm?.trim();
    const date = row.segments?.date;
    if (!term || !date) continue;

    const { periodStart, periodEnd } = dayPeriod(date);
    const dimensions = {
      searchTerm: term,
      campaign: row.campaign?.name ?? "unknown",
    };
    const base = { sourceKey: SOURCE_KEY, periodStart, periodEnd, dimensions };

    metrics.push(
      {
        ...base,
        metricKey: "paid_search_term_impressions",
        value: num(row.metrics?.impressions),
      },
      {
        ...base,
        metricKey: "paid_search_term_clicks",
        value: num(row.metrics?.clicks),
      },
      {
        ...base,
        metricKey: "paid_search_term_cost",
        value: microsToUnits(row.metrics?.costMicros),
        unit: "currency",
      },
      {
        ...base,
        metricKey: "paid_search_term_conversions",
        value: num(row.metrics?.conversions),
      },
    );
  }

  return metrics;
}

export function insightMetricPoints(
  rows: SearchTermInsightRow[],
  campaignName: string,
  period: { periodStart: Date; periodEnd: Date },
): MetricPoint[] {
  const metrics: MetricPoint[] = [];

  for (const row of rows) {
    const category = row.campaignSearchTermInsight?.categoryLabel?.trim();
    if (!category) continue;

    const dimensions = { searchCategory: category, campaign: campaignName };
    const base = {
      sourceKey: SOURCE_KEY,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dimensions,
    };

    metrics.push(
      {
        ...base,
        metricKey: "pmax_search_category_impressions",
        value: num(row.metrics?.impressions),
      },
      {
        ...base,
        metricKey: "pmax_search_category_clicks",
        value: num(row.metrics?.clicks),
      },
      {
        ...base,
        metricKey: "pmax_search_category_conversions",
        value: num(row.metrics?.conversions),
      },
    );
  }

  return metrics;
}

/** Run a report, converting an access-level refusal into a warning. */
async function attempt<T>(
  label: string,
  warnings: string[],
  run: () => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoogleAdsApiError && error.isAccessLevelProblem) {
      warnings.push(
        `${label} unavailable at this token's access level: ${error.message}`,
      );
      return null;
    }

    if (error instanceof GoogleAdsApiError) {
      warnings.push(`${label} failed: ${error.message}`);
      return null;
    }

    throw error;
  }
}

async function fetchKeywordVolumes(
  access: GoogleAdsAccess,
  window: SourceSyncWindow,
  warnings: string[],
) {
  const period = monthPeriod(window);
  const geoTargets = resolveGeoTargets();
  const language = getEnv("GOOGLE_ADS_LANGUAGE_CONSTANT");
  const metrics: MetricPoint[] = [];
  const rawRows: RawMetricRow[] = [];
  let rowsRead = 0;

  for (const geo of geoTargets) {
    for (const keywords of chunk(KEYWORD_SEEDS, KEYWORD_CHUNK_SIZE)) {
      const payload = await attempt(
        `Keyword Planner (${geo.country})`,
        warnings,
        () =>
          googleAdsRequest<{ results?: HistoricalMetricsResult[] }>(
            access,
            `customers/${access.customerId}:generateKeywordHistoricalMetrics`,
            {
              keywords,
              geoTargetConstants: [`geoTargetConstants/${geo.id}`],
              keywordPlanNetwork: "GOOGLE_SEARCH",
              includeAdultKeywords: false,
              ...(language ? { language: `languageConstants/${language}` } : {}),
            },
          ),
      );

      // A refusal is the same for every geo, so stop rather than repeat it 15x.
      if (!payload) {
        return { metrics, rawRows, rowsRead, aborted: true };
      }

      const results = payload.results ?? [];
      rowsRead += results.length;
      metrics.push(...keywordMetricPoints(results, geo.country, period));

      for (const result of results) {
        const keyword = result.text?.trim().toLowerCase();
        if (!keyword) continue;

        rawRows.push({
          sourceKey: SOURCE_KEY,
          externalId: `keyword:${geo.country}:${keyword}`,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          payload: { report: "keyword_historical_metrics", geo, result },
        });
      }
    }
  }

  return { metrics, rawRows, rowsRead, aborted: false };
}

async function fetchKeywordIdeas(
  access: GoogleAdsAccess,
  window: SourceSyncWindow,
  warnings: string[],
) {
  const period = monthPeriod(window);
  const geoTargets = resolveGeoTargets();
  const seedCap = Number(getEnv("GOOGLE_ADS_IDEA_SEED_CAP") ?? "20");
  const seeds = KEYWORD_SEEDS.slice(0, Math.max(0, seedCap));
  const metrics: MetricPoint[] = [];
  const rawRows: RawMetricRow[] = [];
  let rowsRead = 0;

  // Discovery is quota-hungry, so it runs against the primary geo only.
  const geo = geoTargets[0];
  if (!geo || seeds.length === 0) {
    return { metrics, rawRows, rowsRead };
  }

  for (const keywords of chunk(seeds, IDEA_SEED_CHUNK_SIZE)) {
    const payload = await attempt("Keyword ideas", warnings, () =>
      googleAdsRequest<{ results?: KeywordIdeaResult[] }>(
        access,
        `customers/${access.customerId}:generateKeywordIdeas`,
        {
          keywordSeed: { keywords },
          geoTargetConstants: [`geoTargetConstants/${geo.id}`],
          keywordPlanNetwork: "GOOGLE_SEARCH",
          includeAdultKeywords: false,
        },
      ),
    );

    if (!payload) {
      return { metrics, rawRows, rowsRead };
    }

    const results = payload.results ?? [];
    rowsRead += results.length;

    // Only keep ideas we are not already tracking; the rest is noise.
    const fresh = results.filter((result) => {
      const keyword = result.text?.trim().toLowerCase();
      return keyword && !KEYWORD_CLUSTER_BY_TERM[keyword];
    });

    metrics.push(
      ...keywordMetricPoints(
        fresh.map((result) => ({
          text: result.text,
          keywordMetrics: result.keywordIdeaMetrics,
        })),
        geo.country,
        period,
      ),
    );

    for (const result of fresh) {
      const keyword = result.text?.trim().toLowerCase();
      if (!keyword) continue;

      rawRows.push({
        sourceKey: SOURCE_KEY,
        externalId: `idea:${geo.country}:${keyword}`,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        payload: { report: "keyword_ideas", geo, result },
      });
    }
  }

  return { metrics, rawRows, rowsRead };
}

async function fetchSearchTerms(
  access: GoogleAdsAccess,
  window: SourceSyncWindow,
  warnings: string[],
) {
  const startDate = toIsoDate(window.start);
  const endDate = toIsoDate(addUtcDays(window.end, -1));

  const rows = await attempt("Search terms report", warnings, () =>
    googleAdsSearch<SearchTermRow>(
      access,
      `SELECT search_term_view.search_term, segments.date, campaign.name,
              campaign.advertising_channel_type, metrics.impressions,
              metrics.clicks, metrics.cost_micros, metrics.conversions
       FROM search_term_view
       WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    ),
  );

  if (!rows) {
    return { metrics: [], rawRows: [], rowsRead: 0 };
  }

  const rawRows: RawMetricRow[] = rows.map((row, index) => ({
    sourceKey: SOURCE_KEY,
    externalId: `search_term:${row.segments?.date ?? "na"}:${
      row.searchTermView?.searchTerm ?? index
    }:${row.campaign?.id ?? "na"}`,
    periodStart: window.start,
    periodEnd: window.end,
    payload: { report: "search_term_view", row },
  }));

  return {
    metrics: searchTermMetricPoints(rows),
    rawRows,
    rowsRead: rows.length,
  };
}

/**
 * Performance Max spend does not appear in `search_term_view` at all, and Pmax is
 * the bulk of this account's spend. `campaign_search_term_insight` is the only
 * view that covers it, at search-*category* granularity rather than exact
 * queries, and it must be filtered to one campaign at a time.
 */
async function fetchPmaxSearchCategories(
  access: GoogleAdsAccess,
  window: SourceSyncWindow,
  warnings: string[],
) {
  const startDate = toIsoDate(window.start);
  const endDate = toIsoDate(addUtcDays(window.end, -1));
  const period = monthPeriod(window);

  const campaigns = await attempt("Campaign list", warnings, () =>
    googleAdsSearch<CampaignRow>(
      access,
      `SELECT campaign.id, campaign.name, campaign.advertising_channel_type
       FROM campaign
       WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
         AND campaign.status != 'REMOVED'`,
    ),
  );

  if (!campaigns || campaigns.length === 0) {
    return { metrics: [], rawRows: [], rowsRead: 0 };
  }

  const metrics: MetricPoint[] = [];
  const rawRows: RawMetricRow[] = [];
  let rowsRead = 0;

  for (const entry of campaigns) {
    const campaignId = entry.campaign?.id;
    const campaignName = entry.campaign?.name ?? campaignId ?? "unknown";
    if (!campaignId) continue;

    const rows = await attempt(
      `Pmax search categories (${campaignName})`,
      warnings,
      () =>
        googleAdsSearch<SearchTermInsightRow>(
          access,
          `SELECT campaign_search_term_insight.category_label,
                  campaign_search_term_insight.id,
                  metrics.impressions, metrics.clicks, metrics.conversions
           FROM campaign_search_term_insight
           WHERE campaign_search_term_insight.campaign_id = ${campaignId}
             AND segments.date BETWEEN '${startDate}' AND '${endDate}'`,
        ),
    );

    if (!rows) continue;

    rowsRead += rows.length;
    metrics.push(...insightMetricPoints(rows, campaignName, period));

    for (const row of rows) {
      const category = row.campaignSearchTermInsight?.categoryLabel;
      if (!category) continue;

      rawRows.push({
        sourceKey: SOURCE_KEY,
        externalId: `pmax_category:${campaignId}:${category}`,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        payload: { report: "campaign_search_term_insight", campaignName, row },
      });
    }
  }

  return { metrics, rawRows, rowsRead };
}

export const googleAdsApiConnector: SourceConnector = {
  sourceKey: SOURCE_KEY,
  async fetchMetrics(window: SourceSyncWindow) {
    const access = await createGoogleAdsAccess();
    const warnings: string[] = [];

    const volumes = await fetchKeywordVolumes(access, window, warnings);
    const ideas =
      volumes.aborted || getEnv("GOOGLE_ADS_KEYWORD_IDEAS") !== "1"
        ? { metrics: [], rawRows: [], rowsRead: 0 }
        : await fetchKeywordIdeas(access, window, warnings);
    const searchTerms = await fetchSearchTerms(access, window, warnings);
    const pmax = await fetchPmaxSearchCategories(access, window, warnings);

    const metrics = [
      ...volumes.metrics,
      ...ideas.metrics,
      ...searchTerms.metrics,
      ...pmax.metrics,
    ];

    // Nothing came back and every report was refused: surface it rather than
    // recording a clean run that wrote no rows.
    if (metrics.length === 0 && warnings.length > 0) {
      throw new Error(
        `Google Ads API returned no data. ${warnings.join(" | ")}`,
      );
    }

    return {
      sourceKey: SOURCE_KEY,
      rowsRead:
        volumes.rowsRead + ideas.rowsRead + searchTerms.rowsRead + pmax.rowsRead,
      metrics,
      rawRows: [
        ...volumes.rawRows,
        ...ideas.rawRows,
        ...searchTerms.rawRows,
        ...pmax.rawRows,
      ],
      metadata: {
        customerId: access.customerId,
        loginCustomerId: access.loginCustomerId,
        keywordsRequested: KEYWORD_SEEDS.length,
        geoTargets: resolveGeoTargets().map((geo) => geo.country),
        reports: {
          keywordVolumes: volumes.rowsRead,
          keywordIdeas: ideas.rowsRead,
          searchTerms: searchTerms.rowsRead,
          pmaxSearchCategories: pmax.rowsRead,
        },
        warnings,
      },
    };
  },
};
