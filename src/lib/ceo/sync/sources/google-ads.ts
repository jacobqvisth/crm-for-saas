import { google } from "googleapis";
import { addUtcDays, parseGa4Date, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";
import { requireSourceEnv } from "../errors";
import type {
  MetricPoint,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
} from "../types";

type Ga4AdsRow = {
  dimensionValues?: { value?: string | null }[];
  metricValues?: { value?: string | null }[];
};

const GA4_AD_METRICS = [
  "advertiserAdCost",
  "advertiserAdClicks",
  "advertiserAdImpressions",
  "keyEvents",
  "eventCount",
] as const;

function periodFromGa4Date(value: string) {
  const start = parseGa4Date(value);
  return { start, end: addUtcDays(start, 1) };
}

function numberAt(row: Ga4AdsRow, index: number) {
  return Number(row.metricValues?.[index]?.value ?? 0);
}

function getAdsCurrency() {
  return getEnv("GOOGLE_ADS_CURRENCY") ?? "USD";
}

export const googleAdsConnector: SourceConnector = {
  sourceKey: "google_ads",
  async fetchMetrics(window: SourceSyncWindow) {
    requireSourceEnv("Google Ads via GA4", ["GA4_PROPERTY_ID"]);

    const propertyId = getEnv("GA4_PROPERTY_ID")!;
    const startDate = toIsoDate(window.start);
    const endDate = toIsoDate(addUtcDays(window.end, -1));
    const currency = getAdsCurrency();
    const auth = await createGoogleAuth([
      "https://www.googleapis.com/auth/analytics.readonly",
    ]);
    const analyticsData = google.analyticsdata({ version: "v1beta", auth });

    const response = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: "date" },
          { name: "sessionGoogleAdsCampaignId" },
          { name: "sessionGoogleAdsCampaignName" },
        ],
        metrics: GA4_AD_METRICS.map((name) => ({ name })),
        currencyCode: currency,
        limit: "10000",
      },
    });

    const rows = (response.data.rows ?? []) as Ga4AdsRow[];
    const metrics: MetricPoint[] = [];
    const rawRows: RawMetricRow[] = [];

    for (const row of rows) {
      const date = row.dimensionValues?.[0]?.value;
      if (!date) continue;

      const spend = numberAt(row, 0);
      const clicks = numberAt(row, 1);
      const impressions = numberAt(row, 2);
      const keyEvents = numberAt(row, 3);
      const eventCount = numberAt(row, 4);

      if (spend + clicks + impressions + keyEvents + eventCount === 0) {
        continue;
      }

      const campaignId = row.dimensionValues?.[1]?.value ?? "unknown";
      const campaign = row.dimensionValues?.[2]?.value ?? "Unknown campaign";
      const period = periodFromGa4Date(date);
      const dimensions = {
        campaign_id: campaignId,
        campaign,
        reporting_source: "ga4_linked_google_ads",
      };

      metrics.push(
        {
          sourceKey: "google_ads",
          metricKey: "ad_spend",
          periodStart: period.start,
          periodEnd: period.end,
          value: spend,
          unit: "currency",
          currency,
          dimensions,
        },
        {
          sourceKey: "google_ads",
          metricKey: "ad_clicks",
          periodStart: period.start,
          periodEnd: period.end,
          value: clicks,
          dimensions,
        },
        {
          sourceKey: "google_ads",
          metricKey: "ad_impressions",
          periodStart: period.start,
          periodEnd: period.end,
          value: impressions,
          dimensions,
        },
        {
          sourceKey: "google_ads",
          metricKey: "ad_conversions",
          periodStart: period.start,
          periodEnd: period.end,
          value: keyEvents,
          dimensions,
        },
      );

      rawRows.push({
        sourceKey: "google_ads" as const,
        externalId: `${campaignId}-${campaign}-${date}`,
        periodStart: period.start,
        periodEnd: period.end,
        payload: {
          date,
          campaignId,
          campaign,
          advertiserAdCost: spend,
          advertiserAdClicks: clicks,
          advertiserAdImpressions: impressions,
          keyEvents,
          eventCount,
          reportingSource: "ga4_linked_google_ads",
        },
      });
    }

    return {
      sourceKey: "google_ads",
      rowsRead: rows.length,
      metrics,
      rawRows,
      metadata: {
        startDate,
        endDate,
        currency,
        ga4PropertyId: propertyId,
        googleAdsCustomerId: getEnv("GOOGLE_ADS_CUSTOMER_ID") ?? null,
        reportingSource: "ga4_linked_google_ads",
      },
    };
  },
};
