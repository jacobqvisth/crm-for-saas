import { google } from "googleapis";
import { isInternalTestUserOrWorkshop } from "@/config/ceo/internal-test-users";
import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { getEnv, hasSupabaseConfig } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import type { ResolvedDashboardRange } from "@/lib/ceo/time-ranges";

export const PRODUCT_APP_HOST = "app.wrenchlane.com";

const STREAM_IOS = "WrenchLane - iOS";
const STREAM_ANDROID = "WrenchLane - Android";

export type AppUsageGranularity = "hour" | "day" | "week" | "month";

export type AppUsagePlatform = "all" | "web" | "ios" | "android";

export type AppUsagePlatformOption = {
  key: AppUsagePlatform;
  label: string;
  shortLabel: string;
  description: string;
};

export const APP_USAGE_PLATFORMS: readonly AppUsagePlatformOption[] = [
  {
    key: "all",
    label: "All",
    shortLabel: "All",
    description:
      "Product activity only, summed across web (app.wrenchlane.com), iOS, and Android. Marketing-site visits to wrenchlane.com are excluded — All ≈ Web + iOS + Android.",
  },
  {
    key: "web",
    label: "Web",
    shortLabel: "Web",
    description:
      "Only the product app at app.wrenchlane.com. Marketing-site visits to wrenchlane.com are excluded by filtering hostName to app.wrenchlane.com.",
  },
  {
    key: "ios",
    label: "iOS",
    shortLabel: "iOS",
    description:
      "Activity from the WrenchLane iOS native app, attributed to the 'WrenchLane - iOS' Firebase / GA4 stream. Capacitor webview hits that fire to the web stream show up under Web instead.",
  },
  {
    key: "android",
    label: "Android",
    shortLabel: "Android",
    description:
      "Activity from the WrenchLane Android native app, attributed to the 'WrenchLane - Android' Firebase / GA4 stream. Capacitor webview hits that fire to the web stream show up under Web instead.",
  },
];

const APP_USAGE_PLATFORM_KEYS = new Set<string>(
  APP_USAGE_PLATFORMS.map((platform) => platform.key),
);

export function normalizeAppUsagePlatform(
  value: string | string[] | undefined,
): AppUsagePlatform {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && APP_USAGE_PLATFORM_KEYS.has(candidate)) {
    return candidate as AppUsagePlatform;
  }
  return "all";
}

export type AppUsageRow = {
  bucket: string;
  bucketLabel: string;
  bucketShortLabel: string;
  activeUsers: number;
  sessions: number;
  pageViews: number;
  diagnosesMade: number;
  events: number;
  pagesPerSession: number;
};

export type AppUsageData = {
  hostName: string;
  propertyId: string | null;
  generatedAt: string;
  granularity: AppUsageGranularity;
  platform: AppUsagePlatform;
  rows: AppUsageRow[];
  error?: string;
};

type Ga4Row = {
  dimensionValues?: { value?: string | null }[];
  metricValues?: { value?: string | null }[];
};

type DiagnosticRow = {
  created_at: string | null;
  internal_user_id: string | null;
  workshop_id: string | null;
};

const RANGE_GRANULARITY: Record<string, AppUsageGranularity> = {
  today: "hour",
  yesterday: "hour",
  last_7_days: "day",
  this_month: "day",
  last_month: "day",
  last_30_days: "day",
  last_90_days: "week",
  all_time: "month",
};

export function granularityFromRange(
  range: ResolvedDashboardRange,
): AppUsageGranularity {
  const explicit = RANGE_GRANULARITY[range.key];
  if (explicit) return explicit;

  if (!range.start) return "month";
  const days = Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000),
  );
  if (days <= 2) return "hour";
  if (days <= 31) return "day";
  if (days <= 90) return "week";
  return "month";
}

export function granularityNoun(granularity: AppUsageGranularity): string {
  switch (granularity) {
    case "hour":
      return "hour";
    case "day":
      return "day";
    case "week":
      return "week";
    case "month":
      return "month";
  }
}

export function granularityNounPlural(granularity: AppUsageGranularity): string {
  return `${granularityNoun(granularity)}s`;
}

export function granularityColumnHeader(granularity: AppUsageGranularity): string {
  const noun = granularityNoun(granularity);
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function ga4Dimension(granularity: AppUsageGranularity): string {
  switch (granularity) {
    case "hour":
      return "dateHour";
    case "day":
      return "date";
    case "week":
      return "yearWeek";
    case "month":
      return "yearMonth";
  }
}

export function bucketKey(date: Date, granularity: AppUsageGranularity): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");

  switch (granularity) {
    case "hour":
      return `${year}${month}${day}${hour}`;
    case "day":
      return `${year}${month}${day}`;
    case "week":
      return yearWeekFromDate(date);
    case "month":
      return `${year}${month}`;
  }
}

function yearWeekFromDate(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear =
    Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week =
    Math.floor((dayOfYear - 1 + yearStart.getUTCDay()) / 7) + 1;

  return `${date.getUTCFullYear()}${String(week).padStart(2, "0")}`;
}

export function formatBucketLabel(
  bucket: string,
  granularity: AppUsageGranularity,
): { label: string; shortLabel: string } {
  if (!bucket) {
    return { label: "Unknown", shortLabel: "—" };
  }

  switch (granularity) {
    case "hour": {
      if (!/^\d{10}$/.test(bucket)) {
        return { label: bucket, shortLabel: bucket };
      }
      const year = Number(bucket.slice(0, 4));
      const month = Number(bucket.slice(4, 6));
      const day = Number(bucket.slice(6, 8));
      const hour = Number(bucket.slice(8, 10));
      const date = new Date(Date.UTC(year, month - 1, day, hour));
      const dayPart = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      const hourPart = `${String(hour).padStart(2, "0")}:00`;
      return {
        label: `${dayPart} ${hourPart} UTC`,
        shortLabel: hourPart,
      };
    }
    case "day": {
      if (!/^\d{8}$/.test(bucket)) {
        return { label: bucket, shortLabel: bucket };
      }
      const year = Number(bucket.slice(0, 4));
      const month = Number(bucket.slice(4, 6));
      const day = Number(bucket.slice(6, 8));
      const date = new Date(Date.UTC(year, month - 1, day));
      const long = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
      const short = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return { label: long, shortLabel: short };
    }
    case "week": {
      if (!/^\d{6}$/.test(bucket)) {
        return { label: bucket, shortLabel: bucket };
      }
      const year = Number(bucket.slice(0, 4));
      const week = Number(bucket.slice(4));
      return {
        label: `Week ${week}, ${year}`,
        shortLabel: `W${week}`,
      };
    }
    case "month": {
      if (!/^\d{6}$/.test(bucket)) {
        return { label: bucket, shortLabel: bucket };
      }
      const year = Number(bucket.slice(0, 4));
      const month = Number(bucket.slice(4, 6));
      const date = new Date(Date.UTC(year, month - 1, 1));
      return {
        label: date.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }),
        shortLabel: date.toLocaleDateString("en-US", {
          month: "short",
          timeZone: "UTC",
        }),
      };
    }
  }
}

function getStartDate(range: ResolvedDashboardRange) {
  if (range.start) {
    return toIsoDate(range.start);
  }

  return "365daysAgo";
}

async function getDiagnosisCountsByBucket(
  range: ResolvedDashboardRange,
  granularity: AppUsageGranularity,
) {
  const counts = new Map<string, number>();

  if (!hasSupabaseConfig()) {
    return counts;
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return counts;
  }

  let query = supabase
    .from(TABLES.diagnostics)
    .select("created_at, internal_user_id, workshop_id")
    .not("created_at", "is", null)
    .lt("created_at", range.end.toISOString())
    .order("created_at", { ascending: true })
    .limit(10000);

  if (range.start) {
    query = query.gte("created_at", range.start.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error("App usage diagnostics read failed", error);
    return counts;
  }

  for (const row of (data ?? []) as DiagnosticRow[]) {
    if (isInternalTestUserOrWorkshop(row.internal_user_id, row.workshop_id)) {
      continue;
    }
    if (!row.created_at) continue;
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = bucketKey(date, granularity);
    if (!key) continue;

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

type GA4Filter = {
  filter?: {
    fieldName: string;
    stringFilter?: { matchType: string; value: string };
    inListFilter?: { values: string[] };
  };
  andGroup?: { expressions: GA4Filter[] };
  orGroup?: { expressions: GA4Filter[] };
};

function platformDimensionFilter(platform: AppUsagePlatform): GA4Filter {
  switch (platform) {
    case "all":
      // Product activity only: app.wrenchlane.com OR the two native streams.
      // The "Website and web app" GA4 stream contains both wrenchlane.com
      // (marketing) and app.wrenchlane.com (product), so we filter that
      // stream down to the product hostName instead of including it whole.
      return {
        orGroup: {
          expressions: [
            {
              filter: {
                fieldName: "hostName",
                stringFilter: { matchType: "EXACT", value: PRODUCT_APP_HOST },
              },
            },
            {
              filter: {
                fieldName: "streamName",
                inListFilter: { values: [STREAM_IOS, STREAM_ANDROID] },
              },
            },
          ],
        },
      };
    case "web":
      return {
        filter: {
          fieldName: "hostName",
          stringFilter: { matchType: "EXACT", value: PRODUCT_APP_HOST },
        },
      };
    case "ios":
      return {
        filter: {
          fieldName: "streamName",
          stringFilter: { matchType: "EXACT", value: STREAM_IOS },
        },
      };
    case "android":
      return {
        filter: {
          fieldName: "streamName",
          stringFilter: { matchType: "EXACT", value: STREAM_ANDROID },
        },
      };
  }
}

export async function getAppUsageData(
  range: ResolvedDashboardRange,
  platform: AppUsagePlatform = "all",
): Promise<AppUsageData> {
  const granularity = granularityFromRange(range);
  const propertyId = getEnv("GA4_PROPERTY_ID") ?? null;
  const generatedAt = new Date().toISOString();

  if (!propertyId) {
    return {
      hostName: PRODUCT_APP_HOST,
      propertyId,
      generatedAt,
      granularity,
      platform,
      rows: [],
      error: "GA4_PROPERTY_ID is not configured.",
    };
  }

  try {
    const [diagnosesByBucket, response] = await Promise.all([
      getDiagnosisCountsByBucket(range, granularity),
      (async () => {
        const auth = await createGoogleAuth([
          "https://www.googleapis.com/auth/analytics.readonly",
        ]);
        const analyticsData = google.analyticsdata({ version: "v1beta", auth });
        const dimension = ga4Dimension(granularity);

        return analyticsData.properties.runReport({
          property: `properties/${propertyId}`,
          requestBody: {
            dateRanges: [
              {
                startDate: getStartDate(range),
                endDate: toIsoDate(addUtcDays(range.end, -1)),
              },
            ],
            dimensions: [{ name: dimension }],
            metrics: [
              { name: "activeUsers" },
              { name: "sessions" },
              { name: "screenPageViews" },
              { name: "eventCount" },
            ],
            dimensionFilter: platformDimensionFilter(platform),
            orderBys: [{ dimension: { dimensionName: dimension }, desc: false }],
            limit: "5000",
          },
        });
      })(),
    ]);

    const rowMap = new Map<string, AppUsageRow>();

    for (const row of (response.data.rows ?? []) as Ga4Row[]) {
      const bucket = row.dimensionValues?.[0]?.value ?? "";
      const sessions = Number(row.metricValues?.[1]?.value ?? 0);
      const pageViews = Number(row.metricValues?.[2]?.value ?? 0);
      const labels = formatBucketLabel(bucket, granularity);

      rowMap.set(bucket, {
        bucket,
        bucketLabel: labels.label,
        bucketShortLabel: labels.shortLabel,
        activeUsers: Number(row.metricValues?.[0]?.value ?? 0),
        sessions,
        pageViews,
        diagnosesMade: diagnosesByBucket.get(bucket) ?? 0,
        events: Number(row.metricValues?.[3]?.value ?? 0),
        pagesPerSession: sessions > 0 ? pageViews / sessions : 0,
      });
    }

    for (const [bucket, diagnosesMade] of diagnosesByBucket) {
      if (rowMap.has(bucket)) continue;
      const labels = formatBucketLabel(bucket, granularity);

      rowMap.set(bucket, {
        bucket,
        bucketLabel: labels.label,
        bucketShortLabel: labels.shortLabel,
        activeUsers: 0,
        sessions: 0,
        pageViews: 0,
        diagnosesMade,
        events: 0,
        pagesPerSession: 0,
      });
    }

    const rows = [...rowMap.values()].sort((left, right) =>
      left.bucket.localeCompare(right.bucket),
    );

    return {
      hostName: PRODUCT_APP_HOST,
      propertyId,
      generatedAt,
      granularity,
      platform,
      rows,
    };
  } catch (error) {
    return {
      hostName: PRODUCT_APP_HOST,
      propertyId,
      generatedAt,
      granularity,
      platform,
      rows: [],
      error:
        error instanceof Error
          ? error.message
          : "Unable to read GA4 app usage.",
    };
  }
}

// Backward-compatible alias for the old name in case anything else imports it.
export const getWeeklyAppUsageData = getAppUsageData;
export type WeeklyAppUsageRow = AppUsageRow;
export type WeeklyAppUsageData = AppUsageData;
