import { gunzipSync } from "node:zlib";
import { importPKCS8, SignJWT } from "jose";
import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { SyncSkippedError } from "../errors";
import type {
  MetricPoint,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
} from "../types";

type AppStoreRecord = Record<string, string | number | null | undefined>;

type JsonApiLinks = {
  next?: string;
  related?: string;
  self?: string;
};

type JsonApiRelationship = {
  links?: JsonApiLinks;
};

type JsonApiResource<Attributes = Record<string, unknown>> = {
  id: string;
  type: string;
  attributes?: Attributes;
  relationships?: Record<string, JsonApiRelationship>;
  links?: JsonApiLinks;
};

type JsonApiListResponse<Resource extends JsonApiResource = JsonApiResource> = {
  data?: Resource[];
  links?: JsonApiLinks;
};

type JsonApiSingleResponse<Resource extends JsonApiResource = JsonApiResource> = {
  data?: Resource;
  links?: JsonApiLinks;
};

type AnalyticsReportRequestAttributes = {
  accessType?: string;
  stoppedDueToInactivity?: boolean;
};

type AnalyticsReportAttributes = {
  category?: string;
  name?: string;
};

type AnalyticsReportInstanceAttributes = {
  granularity?: string;
  processingDate?: string;
};

type AnalyticsReportSegmentAttributes = {
  checksum?: string;
  sizeInBytes?: number | string;
  url?: string;
};

type DownloadedReportRecord = {
  granularity: string | null;
  instanceId: string;
  processingDate: string | null;
  record: AppStoreRecord;
  reportCategory: string;
  reportId: string;
  reportName: string;
  segmentId: string;
};

type AppleMetricConfig = {
  metricKey: string;
  unit?: MetricPoint["unit"];
};

const APP_STORE_CONNECT_API_BASE = "https://api.appstoreconnect.apple.com/v1";
const SUPPORTED_REPORT_BASE_NAMES = new Set([
  "App Sessions",
  "App Store Discovery and Engagement",
  "App Store Downloads",
  "App Store Installations and Deletions",
  "App Store Web Preview",
]);
const SUPPORTED_REPORT_CATEGORIES = new Set([
  "APP_STORE_ENGAGEMENT",
  "APP_USAGE",
  "COMMERCE",
]);

const APPLE_METRIC_MAP: Record<string, AppleMetricConfig> = {
  app_units: { metricKey: "app_store_downloads" },
  average_session_duration: {
    metricKey: "app_store_average_session_duration",
    unit: "seconds",
  },
  avg_session_duration: {
    metricKey: "app_store_average_session_duration",
    unit: "seconds",
  },
  deletions: { metricKey: "app_store_deletions" },
  downloads: { metricKey: "app_store_downloads" },
  first_downloads: { metricKey: "app_store_downloads" },
  impressions: { metricKey: "app_store_impressions" },
  installs: { metricKey: "app_store_installations" },
  installations: { metricKey: "app_store_installations" },
  page_views: { metricKey: "app_store_page_views" },
  pageviews: { metricKey: "app_store_page_views" },
  product_page_views: { metricKey: "app_store_page_views" },
  sessions: { metricKey: "app_store_sessions" },
  web_product_page_views: { metricKey: "app_store_web_preview_views" },
};

function buildAppStoreApiUrl(path: string) {
  return new URL(path, `${APP_STORE_CONNECT_API_BASE}/`).toString();
}

export function getAppStoreKeyId() {
  return (
    getEnv("APP_STORE_CONNECT_KEY_ID") ?? getEnv("APP_STORE_CONNECT_API_KEY")
  );
}

function getAppStorePrivateKey() {
  const value = getEnv("APP_STORE_CONNECT_PRIVATE_KEY");
  if (!value) {
    return value;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function getAppStoreAppId() {
  return getEnv("APP_STORE_CONNECT_APPLE_ID");
}

export function getAppStoreSetupStatus() {
  return {
    appId: getAppStoreAppId(),
    issuerId: getEnv("APP_STORE_CONNECT_ISSUER_ID"),
    keyId: getAppStoreKeyId(),
    privateKey: getAppStorePrivateKey(),
    reportUrl: getEnv("APP_STORE_CONNECT_ANALYTICS_REPORT_URL"),
  };
}

function assertAppStoreConfigured() {
  const status = getAppStoreSetupStatus();
  const missing: string[] = [];

  if (!status.issuerId) {
    missing.push("APP_STORE_CONNECT_ISSUER_ID");
  }
  if (!status.keyId) {
    missing.push("APP_STORE_CONNECT_KEY_ID");
  }
  if (!status.privateKey) {
    missing.push("APP_STORE_CONNECT_PRIVATE_KEY");
  }
  if (!status.reportUrl && !status.appId) {
    missing.push("APP_STORE_CONNECT_APPLE_ID or APP_STORE_CONNECT_ANALYTICS_REPORT_URL");
  }

  if (missing.length > 0) {
    throw new SyncSkippedError(
      `App Store Connect is not configured. Missing: ${missing.join(", ")}`,
    );
  }
}

async function createAppStoreToken() {
  const privateKey = getAppStorePrivateKey();
  if (!privateKey) {
    throw new SyncSkippedError(
      "App Store Connect is not configured. Missing: APP_STORE_CONNECT_PRIVATE_KEY",
    );
  }

  try {
    const key = await importPKCS8(privateKey.replaceAll("\\n", "\n"), "ES256");

    return new SignJWT({})
      .setProtectedHeader({
        alg: "ES256",
        kid: getAppStoreKeyId()!,
        typ: "JWT",
      })
      .setIssuer(getEnv("APP_STORE_CONNECT_ISSUER_ID")!)
      .setAudience("appstoreconnect-v1")
      .setIssuedAt()
      .setExpirationTime("20m")
      .sign(key);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown private key error";
    throw new SyncSkippedError(
      `APP_STORE_CONNECT_PRIVATE_KEY is invalid. Paste the full contents of the .p8 key file. Apple said: ${message}`,
    );
  }
}

function parseTsv(text: string): AppStoreRecord[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine) return [];

  const headers = headerLine
    .replace(/^\ufeff/, "")
    .split("\t")
    .map((header) =>
      header
        .trim()
        .toLowerCase()
        .replaceAll(" ", "_")
        .replaceAll("-", "_"),
    );

  return lines
    .filter(Boolean)
    .map((line) => {
      const values = line.split("\t");
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? null]),
      ) as AppStoreRecord;
    });
}

function extractRecords(payload: unknown): AppStoreRecord[] {
  if (Array.isArray(payload)) {
    return payload as AppStoreRecord[];
  }

  if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    for (const key of ["data", "reports", "rows", "results"]) {
      if (Array.isArray(object[key])) {
        return object[key] as AppStoreRecord[];
      }
    }
  }

  return [];
}

function readDate(record: AppStoreRecord, fallback: Date) {
  const value =
    record.date ??
    record.start_date ??
    record.event_date ??
    record.report_date ??
    record.day;

  if (typeof value === "string" && value.length > 0) {
    return new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
  }

  return fallback;
}

function readNumber(value: unknown) {
  return Number(String(value ?? "0").replaceAll(",", ""));
}

function describeAppStoreError(status: number, payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "errors" in payload &&
    Array.isArray(payload.errors)
  ) {
    const messages = payload.errors
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const title = "title" in item ? item.title : null;
        const detail = "detail" in item ? item.detail : null;
        return [title, detail].filter(Boolean).join(": ");
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return `App Store Connect API failed (${status}): ${messages.join(" | ")}`;
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return `App Store Connect API failed (${status}): ${payload.trim()}`;
  }

  return `App Store Connect API failed (${status})`;
}

async function fetchAppStoreJson<ResponsePayload>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<ResponsePayload> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(describeAppStoreError(response.status, payload));
  }

  return payload as ResponsePayload;
}

async function listAppStoreResources<Resource extends JsonApiResource>(
  url: string,
  token: string,
): Promise<Resource[]> {
  const resources: Resource[] = [];
  const seen = new Set<string>();
  let nextUrl: string | undefined = url;

  while (nextUrl && !seen.has(nextUrl)) {
    seen.add(nextUrl);
    const page: JsonApiListResponse<Resource> =
      await fetchAppStoreJson<JsonApiListResponse<Resource>>(
      nextUrl,
      token,
      );
    resources.push(...(page.data ?? []));
    nextUrl = page.links?.next;
  }

  return resources;
}

async function fetchAppStoreResource<Resource extends JsonApiResource>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<Resource> {
  const response = await fetchAppStoreJson<JsonApiSingleResponse<Resource>>(
    url,
    token,
    init,
  );
  if (!response.data) {
    throw new Error(`App Store Connect returned no resource for ${url}`);
  }

  return response.data;
}

function relatedLink<Resource extends JsonApiResource>(
  resource: Resource,
  relationshipName: string,
) {
  return resource.relationships?.[relationshipName]?.links?.related;
}

async function readReportRequestsForApp(
  appId: string,
  token: string,
): Promise<JsonApiResource<AnalyticsReportRequestAttributes>[]> {
  const relationshipUrl = buildAppStoreApiUrl(
    `apps/${appId}/relationships/analyticsReportRequests?limit=200`,
  );

  try {
    const linkages = await listAppStoreResources(relationshipUrl, token);
    const ids = linkages.map((item) => item.id).filter(Boolean);

    return await Promise.all(
      ids.map((id) =>
        fetchAppStoreResource<JsonApiResource<AnalyticsReportRequestAttributes>>(
          buildAppStoreApiUrl(`analyticsReportRequests/${id}`),
          token,
        ),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("404")) {
      throw error;
    }
  }

  return listAppStoreResources<JsonApiResource<AnalyticsReportRequestAttributes>>(
    buildAppStoreApiUrl(`apps/${appId}/analyticsReportRequests?limit=200`),
    token,
  );
}

async function createOngoingReportRequest(appId: string, token: string) {
  return fetchAppStoreResource<JsonApiResource<AnalyticsReportRequestAttributes>>(
    buildAppStoreApiUrl("analyticsReportRequests"),
    token,
    {
      body: JSON.stringify({
        data: {
          type: "analyticsReportRequests",
          attributes: {
            accessType: "ONGOING",
          },
          relationships: {
            app: {
              data: {
                type: "apps",
                id: appId,
              },
            },
          },
        },
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}

async function ensureReportRequest(
  appId: string,
  token: string,
): Promise<JsonApiResource<AnalyticsReportRequestAttributes>> {
  const existing = await readReportRequestsForApp(appId, token);
  const active = existing.find(
    (request) =>
      request.attributes?.accessType === "ONGOING" &&
      !request.attributes?.stoppedDueToInactivity,
  );

  if (active) {
    return active;
  }

  try {
    return await createOngoingReportRequest(appId, token);
  } catch (error) {
    if (existing.length > 0) {
      return existing[0];
    }
    throw error;
  }
}

export function normalizeReportName(name?: string) {
  return (name ?? "")
    .replace(/\s+(Detailed|Standard)$/i, "")
    .trim();
}

function reportPreferenceScore(
  report: JsonApiResource<AnalyticsReportAttributes>,
) {
  const name = report.attributes?.name ?? "";
  if (/\bDetailed\b/i.test(name)) return 2;
  if (/\bStandard\b/i.test(name)) return 1;
  return 0;
}

export function selectAnalyticsReports(
  reports: JsonApiResource<AnalyticsReportAttributes>[],
) {
  const supported = reports.filter((report) => {
    const baseName = normalizeReportName(report.attributes?.name);
    return (
      SUPPORTED_REPORT_BASE_NAMES.has(baseName) ||
      SUPPORTED_REPORT_CATEGORIES.has(report.attributes?.category ?? "")
    );
  });
  const selected = new Map<string, JsonApiResource<AnalyticsReportAttributes>>();

  for (const report of supported) {
    const baseName =
      normalizeReportName(report.attributes?.name) || `report:${report.id}`;
    const current = selected.get(baseName);

    if (!current || reportPreferenceScore(report) > reportPreferenceScore(current)) {
      selected.set(baseName, report);
    }
  }

  return [...selected.values()].sort((left, right) =>
    (left.attributes?.name ?? "").localeCompare(right.attributes?.name ?? ""),
  );
}

async function readReportsForRequest(
  reportRequest: JsonApiResource<AnalyticsReportRequestAttributes>,
  token: string,
) {
  const url =
    relatedLink(reportRequest, "reports") ??
    buildAppStoreApiUrl(`analyticsReportRequests/${reportRequest.id}/reports?limit=200`);

  return listAppStoreResources<JsonApiResource<AnalyticsReportAttributes>>(
    url,
    token,
  );
}

async function readInstancesForReport(
  reportId: string,
  token: string,
  dailyOnly = true,
) {
  const url = new URL(buildAppStoreApiUrl(`analyticsReports/${reportId}/instances`));
  url.searchParams.set("limit", "200");
  if (dailyOnly) {
    url.searchParams.set("filter[granularity]", "DAILY");
  }

  return listAppStoreResources<JsonApiResource<AnalyticsReportInstanceAttributes>>(
    url.toString(),
    token,
  );
}

export function selectReportInstances(
  instances: JsonApiResource<AnalyticsReportInstanceAttributes>[],
  window: SourceSyncWindow,
) {
  const sorted = [...instances].sort((left, right) =>
    (right.attributes?.processingDate ?? "").localeCompare(
      left.attributes?.processingDate ?? "",
    ),
  );
  const eligibleProcessingDate = toIsoDate(addUtcDays(window.start, -3));
  const pool = sorted.filter(
    (instance) => instance.attributes?.granularity === "DAILY",
  );
  const candidatePool = pool.length > 0 ? pool : sorted;
  const recent = candidatePool.filter(
    (instance) =>
      (instance.attributes?.processingDate ?? "") >= eligibleProcessingDate,
  );

  return (recent.length > 0 ? recent : candidatePool).slice(0, 14);
}

async function readSegmentsForInstance(instanceId: string, token: string) {
  return listAppStoreResources<JsonApiResource<AnalyticsReportSegmentAttributes>>(
    buildAppStoreApiUrl(`analyticsReportInstances/${instanceId}/segments?limit=200`),
    token,
  );
}

async function resolveSegmentDownloadUrl(
  segment: JsonApiResource<AnalyticsReportSegmentAttributes>,
  token: string,
) {
  const inlineUrl = segment.attributes?.url;
  if (inlineUrl) {
    return inlineUrl;
  }

  const full = await fetchAppStoreResource<
    JsonApiResource<AnalyticsReportSegmentAttributes>
  >(buildAppStoreApiUrl(`analyticsReportSegments/${segment.id}`), token);
  const detailUrl = full.attributes?.url;

  if (!detailUrl) {
    throw new Error(
      `App Store Connect did not provide a download URL for report segment ${segment.id}.`,
    );
  }

  return detailUrl;
}

async function downloadReportBuffer(url: string, token?: string) {
  const target = new URL(url);
  const response = await fetch(url, {
    headers:
      target.hostname === "api.appstoreconnect.apple.com" && token
        ? { authorization: `Bearer ${token}` }
        : undefined,
  });

  if (!response.ok) {
    throw new Error(`App Store Connect report download failed: ${response.status}`);
  }

  let buffer = Buffer.from(await response.arrayBuffer());
  if (
    response.headers.get("content-encoding") === "gzip" ||
    target.pathname.endsWith(".gz")
  ) {
    buffer = gunzipSync(buffer);
  }

  return buffer;
}

function parseReportBuffer(buffer: Buffer) {
  const text = buffer.toString("utf8");
  const trimmed = text.trim();

  return trimmed.startsWith("{") || trimmed.startsWith("[")
    ? extractRecords(JSON.parse(trimmed))
    : parseTsv(trimmed);
}

async function readRecordsFromManualReportUrl(
  reportUrl: string,
  token: string,
): Promise<DownloadedReportRecord[]> {
  const records = parseReportBuffer(await downloadReportBuffer(reportUrl, token));

  return records.map((record, index) => ({
    granularity: null,
    instanceId: "manual-report-url",
    processingDate: null,
    record,
    reportCategory: "manual",
    reportId: "manual-report-url",
    reportName: "Manual App Store Connect report",
    segmentId: `segment-${index}`,
  }));
}

async function readRecordsFromAnalyticsApi(
  window: SourceSyncWindow,
  token: string,
): Promise<DownloadedReportRecord[]> {
  const appId = getAppStoreAppId();
  if (!appId) {
    throw new SyncSkippedError(
      "App Store Connect analytics discovery needs APP_STORE_CONNECT_APPLE_ID, or set APP_STORE_CONNECT_ANALYTICS_REPORT_URL instead.",
    );
  }

  const reportRequest = await ensureReportRequest(appId, token);
  const reports = selectAnalyticsReports(
    await readReportsForRequest(reportRequest, token),
  );

  if (reports.length === 0) {
    throw new SyncSkippedError(
      "App Store Connect is connected, but no supported analytics reports are available yet. Apple says the first ONGOING reports usually appear after 24-48 hours.",
    );
  }

  const allRecords: DownloadedReportRecord[] = [];

  for (const report of reports) {
    const reportName = report.attributes?.name ?? "Unknown report";
    const reportCategory = report.attributes?.category ?? "UNKNOWN";
    const dailyInstances = await readInstancesForReport(report.id, token, true);
    const instances =
      dailyInstances.length > 0
        ? dailyInstances
        : await readInstancesForReport(report.id, token, false);
    const selectedInstances = selectReportInstances(instances, window);

    for (const instance of selectedInstances) {
      const segments = await readSegmentsForInstance(instance.id, token);

      for (const segment of segments) {
        const records = parseReportBuffer(
          await downloadReportBuffer(
            await resolveSegmentDownloadUrl(segment, token),
          ),
        );

        for (const record of records) {
          allRecords.push({
            granularity: instance.attributes?.granularity ?? null,
            instanceId: instance.id,
            processingDate: instance.attributes?.processingDate ?? null,
            record,
            reportCategory,
            reportId: report.id,
            reportName,
            segmentId: segment.id,
          });
        }
      }
    }
  }

  return allRecords;
}

export const appStoreConnectConnector: SourceConnector = {
  sourceKey: "app_store_connect",
  async fetchMetrics(window: SourceSyncWindow) {
    assertAppStoreConfigured();

    const token = await createAppStoreToken();
    const manualReportUrl = getEnv("APP_STORE_CONNECT_ANALYTICS_REPORT_URL");
    const downloadedRecords = manualReportUrl
      ? await readRecordsFromManualReportUrl(manualReportUrl, token)
      : await readRecordsFromAnalyticsApi(window, token);
    const metrics: MetricPoint[] = [];
    const rawRows: RawMetricRow[] = [];

    for (const [index, item] of downloadedRecords.entries()) {
      const periodStart = readDate(item.record, window.start);
      const periodEnd = addUtcDays(periodStart, 1);

      for (const [rawKey, config] of Object.entries(APPLE_METRIC_MAP)) {
        if (item.record[rawKey] === undefined) continue;

        metrics.push({
          sourceKey: "app_store_connect",
          metricKey: config.metricKey,
          periodStart,
          periodEnd,
          value: readNumber(item.record[rawKey]),
          unit: config.unit,
          dimensions: {
            granularity: item.granularity ?? "unknown",
            report: item.reportName,
            source_type: String(
              item.record.source_type ?? item.record.source ?? "all",
            ),
            territory: String(item.record.territory ?? item.record.country ?? "all"),
            // install_type distinguishes first-time / redownload / auto-download
            // rows in Apple's Platform App Installs report. Include it in
            // dimensions so the per-type rows don't collide on the
            // (source_key, metric_key, period_start, period_end, dimension_key)
            // conflict key (which would make the writer's last-value-wins
            // de-dup drop all but one type).
            install_type: String(item.record.install_type ?? "all"),
          },
        });
      }

      rawRows.push({
        sourceKey: "app_store_connect",
        externalId: `${item.reportId}:${item.instanceId}:${item.segmentId}:${index}`,
        periodStart,
        periodEnd,
        payload: {
          ...item.record,
          _granularity: item.granularity,
          _processing_date: item.processingDate,
          _report_category: item.reportCategory,
          _report_id: item.reportId,
          _report_name: item.reportName,
          _segment_id: item.segmentId,
        },
      });
    }

    return {
      sourceKey: "app_store_connect",
      rowsRead: downloadedRecords.length,
      metrics,
      rawRows,
      metadata: {
        appId: getAppStoreAppId() ?? null,
        bundleId: getEnv("APP_STORE_CONNECT_BUNDLE_ID") ?? null,
        mode: manualReportUrl ? "manual_report_url" : "analytics_api",
        reportUrl: manualReportUrl ? new URL(manualReportUrl).origin : null,
      },
    };
  },
};
