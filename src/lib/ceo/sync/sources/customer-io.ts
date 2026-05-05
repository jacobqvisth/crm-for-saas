import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { requireSourceEnv } from "../errors";
import type { MetricPoint, SourceConnector, SourceSyncWindow } from "../types";

type CustomerIoMetricRecord = Record<string, unknown>;

const METRIC_MAP: Record<string, string> = {
  sent: "cio_sent",
  delivered: "cio_delivered",
  opened: "cio_opened",
  human_opened: "cio_human_opened",
  clicked: "cio_clicked",
  human_clicked: "cio_human_clicked",
  converted: "cio_converted",
  unsubscribed: "cio_unsubscribed",
  bounced: "cio_bounced",
};

type CustomerIoCampaign = {
  id: number;
  name?: string;
  active?: boolean;
  state?: string;
  type?: string;
};

type CustomerIoCampaignsResponse = {
  campaigns?: CustomerIoCampaign[];
};

type CustomerIoMetricsResponse = {
  metric?: {
    series?: Record<string, number[]>;
  };
};

function normalizeMetricName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");
}

function extractRecords(payload: unknown): CustomerIoMetricRecord[] {
  if (Array.isArray(payload)) {
    return payload as CustomerIoMetricRecord[];
  }

  if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    for (const key of ["metrics", "data", "results", "rows"]) {
      if (Array.isArray(object[key])) {
        return object[key] as CustomerIoMetricRecord[];
      }
    }
  }

  return [];
}

function readNumber(record: CustomerIoMetricRecord) {
  return Number(record.value ?? record.count ?? record.total ?? 0);
}

function getCustomerIoBaseUrl() {
  return getEnv("CUSTOMER_IO_REGION")?.toLowerCase() === "eu"
    ? "https://api-eu.customer.io/v1"
    : "https://api.customer.io/v1";
}

async function fetchCustomerIoJson<T>(
  path: string,
  searchParams?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${getCustomerIoBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${getEnv("CUSTOMER_IO_APP_API_KEY")}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Customer.io API failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function readDate(record: CustomerIoMetricRecord, fallback: Date) {
  const value =
    record.date ?? record.period_start ?? record.timestamp ?? record.created_at;

  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  if (typeof value === "string" && value.length > 0) {
    return new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
  }

  return fallback;
}

export const customerIoConnector: SourceConnector = {
  sourceKey: "customer_io",
  async fetchMetrics(window: SourceSyncWindow) {
    requireSourceEnv("Customer.io", ["CUSTOMER_IO_APP_API_KEY"]);

    const endpoint = getEnv("CUSTOMER_IO_METRICS_ENDPOINT");
    if (!endpoint) {
      return fetchCampaignMetrics(window);
    }

    const url = new URL(endpoint);
    url.searchParams.set("start", toIsoDate(window.start));
    url.searchParams.set("end", toIsoDate(addUtcDays(window.end, -1)));

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${getEnv("CUSTOMER_IO_APP_API_KEY")}`,
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Customer.io API failed: ${response.status}`);
    }

    const payload = await response.json();
    const records = extractRecords(payload);
    const metrics: MetricPoint[] = [];

    for (const record of records) {
      const rawMetric =
        record.metric ?? record.name ?? record.event ?? record.metric_name;
      const metricKey = METRIC_MAP[normalizeMetricName(rawMetric)];
      if (!metricKey) continue;

      const periodStart = readDate(record, window.start);
      const periodEnd = addUtcDays(periodStart, 1);

      metrics.push({
        sourceKey: "customer_io",
        metricKey,
        periodStart,
        periodEnd,
        value: readNumber(record),
        dimensions: {
          channel: String(record.channel ?? "all"),
          campaign_id: String(record.campaign_id ?? record.campaignId ?? "all"),
        },
      });
    }

    return {
      sourceKey: "customer_io",
      rowsRead: records.length,
      metrics,
      rawRows: records.map((record, index) => ({
        sourceKey: "customer_io",
        externalId: String(record.id ?? `${index}-${record.metric ?? "metric"}`),
        periodStart: readDate(record, window.start),
        periodEnd: addUtcDays(readDate(record, window.start), 1),
        payload: record,
      })),
      metadata: {
        endpoint: url.origin,
        region: getEnv("CUSTOMER_IO_REGION") ?? "us",
      },
    };
  },
};

async function fetchCampaignMetrics(window: SourceSyncWindow) {
  const campaignsResponse =
    await fetchCustomerIoJson<CustomerIoCampaignsResponse>("/campaigns");
  const campaigns = campaignsResponse.campaigns ?? [];
  const metrics: MetricPoint[] = [];
  const rawRows = [];
  const start = Math.floor(window.start.getTime() / 1000).toString();
  const end = Math.floor(window.end.getTime() / 1000).toString();

  for (const campaign of campaigns) {
    const metricsResponse =
      await fetchCustomerIoJson<CustomerIoMetricsResponse>(
        `/campaigns/${campaign.id}/metrics/`,
        {
          res: "daily",
          version: "2",
          start,
          end,
          tz: "Europe/Stockholm",
        },
      );
    const series = metricsResponse.metric?.series ?? {};

    rawRows.push({
      sourceKey: "customer_io" as const,
      externalId: `campaign-${campaign.id}-metrics`,
      periodStart: window.start,
      periodEnd: window.end,
      payload: {
        campaign,
        metric: metricsResponse.metric,
      } as Record<string, unknown>,
    });

    for (const [rawMetric, values] of Object.entries(series)) {
      const metricKey = METRIC_MAP[normalizeMetricName(rawMetric)];
      if (!metricKey || !Array.isArray(values)) continue;

      values.forEach((value, index) => {
        const periodStart = addUtcDays(window.start, index);
        const periodEnd = addUtcDays(periodStart, 1);

        if (periodStart >= window.end) return;

        metrics.push({
          sourceKey: "customer_io",
          metricKey,
          periodStart,
          periodEnd,
          value: Number(value ?? 0),
          dimensions: {
            campaign_id: campaign.id,
            campaign: campaign.name ?? `Campaign ${campaign.id}`,
            campaign_state: campaign.state ?? "unknown",
            campaign_type: campaign.type ?? "unknown",
          },
        });
      });
    }
  }

  return {
    sourceKey: "customer_io" as const,
    rowsRead: campaigns.length,
    metrics,
    rawRows,
    metadata: {
      campaigns: campaigns.length,
      region: getEnv("CUSTOMER_IO_REGION") ?? "us",
      baseUrl: getCustomerIoBaseUrl(),
    },
  };
}
