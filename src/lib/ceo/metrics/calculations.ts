import { FUNNEL_STEPS } from "@/config/ceo/kpi-events";
import { hoursSince } from "@/lib/ceo/dates";
import {
  compactNumber,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/ceo/format";
import { SOURCE_KEYS, SOURCE_LABELS, type SourceKey } from "@/lib/ceo/sources";
import {
  DEFAULT_TIME_RANGE_KEY,
  formatRangeDateSpan,
  getDashboardTimeRangeOptions,
  resolveDashboardTimeRange,
  type ResolvedDashboardRange,
} from "@/lib/ceo/time-ranges";
import type {
  AcquisitionCampaign,
  AcquisitionTrendPoint,
  DashboardData,
  EnrichmentCoverage,
  FunnelSnapshot,
  FunnelStep,
  KpiCard,
  LifecycleCampaign,
  MetricSnapshot,
  MotorUsageBreakdown,
  OrganicBreakdownRow,
  OrganicTrendPoint,
  OperationsSummary,
  OperationsTrendPoint,
  PerformancePoint,
  ProductTrendPoint,
  RecentSyncRun,
  RevenueTrendPoint,
  SourceHealth,
  SyncRun,
  WarehouseSubscription,
  WarehouseUser,
  WarehouseWorkshop,
  WorkshopSnapshot,
} from "./types";

function metricRows(
  snapshots: MetricSnapshot[],
  metricKey: string,
  sourceKey?: SourceKey,
) {
  return snapshots.filter(
    (snapshot) =>
      snapshot.metric_key === metricKey &&
      (!sourceKey || snapshot.source_key === sourceKey),
  );
}

function sumMetric(
  snapshots: MetricSnapshot[],
  metricKey: string,
  sourceKey?: SourceKey,
) {
  const rows = metricRows(snapshots, metricKey, sourceKey);
  const totalRows = rows.filter((row) => row.dimension_key === "total");
  const usableRows = totalRows.length > 0 ? totalRows : rows;

  return usableRows.reduce((sum, row) => sum + Number(row.value), 0);
}

function latestMetric(
  snapshots: MetricSnapshot[],
  metricKey: string,
  sourceKey?: SourceKey,
) {
  const rows = metricRows(snapshots, metricKey, sourceKey)
    .filter((row) => row.dimension_key === "total")
    .sort((left, right) => right.period_end.localeCompare(left.period_end));

  return Number(rows[0]?.value ?? 0);
}

function latestMetricValue(
  snapshots: MetricSnapshot[],
  metricKey: string,
  sourceKey?: SourceKey,
) {
  const rows = metricRows(snapshots, metricKey, sourceKey).sort((left, right) =>
    right.period_end.localeCompare(left.period_end),
  );
  const totalRows = rows.filter((row) => row.dimension_key === "total");
  const preferredRows = totalRows.length > 0 ? totalRows : rows;

  return Number(preferredRows[0]?.value ?? 0);
}

function safeRate(numerator: number, denominator: number) {
  if (!denominator || !Number.isFinite(denominator)) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

function asString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function normalizeStoredPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value <= 1 ? value * 100 : value;
}

function metricValueOrFallback(
  snapshots: MetricSnapshot[],
  preferredMetricKey: string,
  preferredSourceKey: SourceKey,
  fallbackMetricKey: string,
  fallbackSourceKey: SourceKey,
) {
  const preferredRows = metricRows(
    snapshots,
    preferredMetricKey,
    preferredSourceKey,
  );
  const preferred = preferredRows.reduce(
    (sum, row) => sum + Number(row.value),
    0,
  );

  return preferredRows.length > 0
    ? preferred
    : sumMetric(snapshots, fallbackMetricKey, fallbackSourceKey);
}

function buildFunnel(
  snapshots: MetricSnapshot[],
  funnelSnapshots: FunnelSnapshot[],
): FunnelStep[] {
  return FUNNEL_STEPS.map((step, index) => {
    const explicit = funnelSnapshots
      .filter(
        (snapshot) =>
          snapshot.step_key === step.key && snapshot.dimension_key === "total",
      )
      .reduce((sum, snapshot) => sum + Number(snapshot.count), 0);
    const value =
      explicit ||
      sumMetric(snapshots, step.metricKey, step.sourceKey as SourceKey);
    const previous = index === 0 ? value : 0;

    return {
      key: step.key,
      label: step.label,
      value,
      conversionFromPrevious: previous ? 100 : 0,
    };
  }).map((step, index, allSteps) => {
    const previous = index === 0 ? step.value : allSteps[index - 1].value;
    return {
      ...step,
      conversionFromPrevious: index === 0 ? 100 : safeRate(step.value, previous),
    };
  });
}

function buildSourceHealth(syncRuns: SyncRun[], now = new Date()): SourceHealth[] {
  return SOURCE_KEYS.map((sourceKey) => {
    const runs = syncRuns
      .filter((run) => run.source_key === sourceKey)
      .sort((left, right) => right.started_at.localeCompare(left.started_at));
    const latestRun = runs[0];
    const latestSuccess = runs.find((run) => run.status === "success");
    const lag = hoursSince(latestSuccess?.completed_at, now);
    const status =
      !latestRun || !latestSuccess
        ? "pending"
        : latestRun.status === "failed"
          ? "failing"
          : lag > 4
            ? "stale"
            : "healthy";

    return {
      sourceKey,
      label: SOURCE_LABELS[sourceKey],
      status,
      lastSuccessAt: latestSuccess?.completed_at ?? null,
      hoursSinceSuccess: lag,
      lastError: latestRun?.error_message ?? null,
    };
  });
}

function buildRecentSyncRuns(syncRuns: SyncRun[]): RecentSyncRun[] {
  return [...syncRuns]
    .sort((left, right) => right.started_at.localeCompare(left.started_at))
    .slice(0, 12)
    .map((run) => ({
      sourceKey: run.source_key,
      label: SOURCE_LABELS[run.source_key],
      status: run.status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      rowsRead: run.rows_read,
      rowsWritten: run.rows_written,
      errorMessage: run.error_message,
    }));
}

function buildPlatformSplit(snapshots: MetricSnapshot[]) {
  const rows = metricRows(snapshots, "active_users", "ga4").filter(
    (row) => row.dimension_key !== "total",
  );
  const totals = new Map<string, number>();

  for (const row of rows) {
    const platform = String(row.dimensions.platform ?? "unknown");
    totals.set(platform, (totals.get(platform) ?? 0) + Number(row.value));
  }

  return [...totals.entries()]
    .map(([platform, users]) => ({ platform, users }))
    .sort((left, right) => right.users - left.users);
}

function buildPerformanceSeries(snapshots: MetricSnapshot[]): PerformancePoint[] {
  const keys = new Set([
    "cio_sent",
    "cio_human_opened",
    "cio_human_clicked",
    "cio_converted",
    "cio_bounced",
    "cio_unsubscribed",
  ]);
  const byDate = new Map<string, PerformancePoint>();

  for (const snapshot of snapshots) {
    if (!keys.has(snapshot.metric_key)) continue;

    const date = snapshot.period_start.slice(0, 10);
    const point =
      byDate.get(date) ??
      ({
        date,
        sent: 0,
        opened: 0,
        clicked: 0,
        converted: 0,
        bounced: 0,
        unsubscribed: 0,
      } satisfies PerformancePoint);
    const value = Number(snapshot.value);

    if (snapshot.metric_key === "cio_sent") point.sent += value;
    if (snapshot.metric_key === "cio_human_opened") point.opened += value;
    if (snapshot.metric_key === "cio_human_clicked") point.clicked += value;
    if (snapshot.metric_key === "cio_converted") point.converted += value;
    if (snapshot.metric_key === "cio_bounced") point.bounced += value;
    if (snapshot.metric_key === "cio_unsubscribed") point.unsubscribed += value;

    byDate.set(date, point);
  }

  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function metricSeriesByDate(
  snapshots: MetricSnapshot[],
  metricKey: string,
  sourceKey?: SourceKey,
) {
  const grouped = new Map<string, MetricSnapshot[]>();

  for (const row of metricRows(snapshots, metricKey, sourceKey)) {
    const date = row.period_start.slice(0, 10);
    const current = grouped.get(date) ?? [];
    current.push(row);
    grouped.set(date, current);
  }

  const series = new Map<string, number>();

  for (const [date, rows] of grouped) {
    const totalRows = rows.filter((row) => row.dimension_key === "total");
    const usableRows = totalRows.length > 0 ? totalRows : rows;
    series.set(
      date,
      usableRows.reduce((sum, row) => sum + Number(row.value), 0),
    );
  }

  return series;
}

// Enumerate every YYYY-MM-DD date between start and end (inclusive on
// both ends). Used to pre-seed trend bucket sets so zero-data days
// render instead of vanishing. Caps at 366 days to keep "last 90 days"
// + "last year" trend views sane; "all_time" tails always have data
// anyway so the union-of-keys fallback covers them.
function enumerateIsoDates(start: Date, end: Date): string[] {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const cursor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    ),
  );
  const endStamp = end.getTime();
  const MAX = 366;
  while (cursor.getTime() <= endStamp && out.length < MAX) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function buildTrendPoints<T extends { date: string }>(
  maps: Array<[keyof Omit<T, "date">, Map<string, number>]>,
  create: (date: string) => T,
  range?: ResolvedDashboardRange,
) {
  // Seed the date set with every day in the requested range so a day
  // with literally zero across every metric still renders as a zero
  // row on the trend chart. Without this, zero-everywhere days drop
  // off the timeline entirely (see PR #205 for the same fix on
  // /ceo/new-users + /ceo/app-usage). Open-ended ranges (range.start
  // is null, e.g. "all_time") fall back to the union-of-data behavior
  // — those tails always have data anyway and enumerating from epoch
  // would be wasteful.
  const dates = new Set<string>();
  if (range?.start) {
    for (const d of enumerateIsoDates(range.start, range.end)) dates.add(d);
  }

  for (const [, series] of maps) {
    for (const date of series.keys()) {
      dates.add(date);
    }
  }

  return [...dates]
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const point = create(date);
      const mutablePoint = point as Record<string, number | string>;

      for (const [key, series] of maps) {
        mutablePoint[key as string] = series.get(date) ?? 0;
      }

      return point;
    });
}

function buildAcquisitionTrend(
  snapshots: MetricSnapshot[],
  range?: ResolvedDashboardRange,
): AcquisitionTrendPoint[] {
  return buildTrendPoints<AcquisitionTrendPoint>(
    [
      ["spend", metricSeriesByDate(snapshots, "ad_spend", "google_ads")],
      ["clicks", metricSeriesByDate(snapshots, "ad_clicks", "google_ads")],
      [
        "conversions",
        metricSeriesByDate(snapshots, "ad_signups", "google_ads"),
      ],
    ],
    (date) => ({ date, spend: 0, clicks: 0, conversions: 0 }),
    range,
  );
}

function buildOrganicTrend(
  snapshots: MetricSnapshot[],
  range?: ResolvedDashboardRange,
): OrganicTrendPoint[] {
  const clicks = metricSeriesByDate(
    snapshots,
    "organic_search_clicks",
    "search_console",
  );
  const impressions = metricSeriesByDate(
    snapshots,
    "organic_search_impressions",
    "search_console",
  );
  const ctr = metricSeriesByDate(snapshots, "organic_search_ctr", "search_console");
  const position = metricSeriesByDate(
    snapshots,
    "organic_search_position",
    "search_console",
  );

  return buildTrendPoints<OrganicTrendPoint>(
    [
      ["clicks", clicks],
      ["impressions", impressions],
      ["ctr", ctr],
      ["position", position],
    ],
    (date) => ({
      date,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    }),
    range,
  );
}

function isDimensionOnlyRow(row: MetricSnapshot, dimensionName: string) {
  return (
    row.dimension_key !== "total" &&
    Object.keys(row.dimensions ?? {}).length === 1 &&
    dimensionName in (row.dimensions ?? {})
  );
}

function buildOrganicBreakdown(
  snapshots: MetricSnapshot[],
  dimensionName: "query" | "page" | "device" | "country",
): OrganicBreakdownRow[] {
  const composite = new Map<
    string,
    {
      label: string;
      clicks: number;
      impressions: number;
      position: number;
    }
  >();

  for (const row of snapshots) {
    if (row.source_key !== "search_console" || !isDimensionOnlyRow(row, dimensionName)) {
      continue;
    }

    const label = asString(row.dimensions[dimensionName]) ?? "Unknown";
    const key = `${row.period_start.slice(0, 10)}:${label}`;
    const current =
      composite.get(key) ??
      ({
        label,
        clicks: 0,
        impressions: 0,
        position: 0,
      } as const);
    const value = Number(row.value);

    if (row.metric_key === "organic_search_clicks") {
      composite.set(key, { ...current, clicks: current.clicks + value });
      continue;
    }

    if (row.metric_key === "organic_search_impressions") {
      composite.set(key, {
        ...current,
        impressions: current.impressions + value,
      });
      continue;
    }

    if (row.metric_key === "organic_search_position") {
      composite.set(key, {
        ...current,
        position: value,
      });
    }
  }

  const byLabel = new Map<
    string,
    { clicks: number; impressions: number; weightedPosition: number }
  >();

  for (const item of composite.values()) {
    const current =
      byLabel.get(item.label) ??
      ({ clicks: 0, impressions: 0, weightedPosition: 0 } as const);

    byLabel.set(item.label, {
      clicks: current.clicks + item.clicks,
      impressions: current.impressions + item.impressions,
      weightedPosition:
        current.weightedPosition + item.position * item.impressions,
    });
  }

  return [...byLabel.entries()]
    .map(([label, values]) => ({
      label,
      clicks: values.clicks,
      impressions: values.impressions,
      ctr: safeRate(values.clicks, values.impressions),
      position: values.impressions
        ? values.weightedPosition / values.impressions
        : 0,
    }))
    .filter((row) => row.clicks > 0 || row.impressions > 0)
    .sort(
      (left, right) =>
        right.clicks - left.clicks ||
        right.impressions - left.impressions ||
        left.label.localeCompare(right.label),
    )
    .slice(0, 12);
}

function buildOrganicSummary(snapshots: MetricSnapshot[]) {
  const clicks = sumMetric(snapshots, "organic_search_clicks", "search_console");
  const impressions = sumMetric(
    snapshots,
    "organic_search_impressions",
    "search_console",
  );
  const positionRows = metricRows(
    snapshots,
    "organic_search_position",
    "search_console",
  ).filter((row) => row.dimension_key === "total");
  const impressionRows = metricRows(
    snapshots,
    "organic_search_impressions",
    "search_console",
  ).filter((row) => row.dimension_key === "total");
  const impressionsByDay = new Map(
    impressionRows.map((row) => [row.period_start.slice(0, 10), Number(row.value)]),
  );
  const weightedPosition = positionRows.reduce((sum, row) => {
    const day = row.period_start.slice(0, 10);
    const weight = impressionsByDay.get(day) ?? 0;
    return sum + Number(row.value) * weight;
  }, 0);

  return {
    clicks,
    impressions,
    ctr: safeRate(clicks, impressions),
    position: impressions ? weightedPosition / impressions : 0,
    topQueries: buildOrganicBreakdown(snapshots, "query"),
    topPages: buildOrganicBreakdown(snapshots, "page"),
    devices: buildOrganicBreakdown(snapshots, "device"),
    countries: buildOrganicBreakdown(snapshots, "country"),
  };
}

function buildProductTrend(
  snapshots: MetricSnapshot[],
  range?: ResolvedDashboardRange,
): ProductTrendPoint[] {
  return buildTrendPoints<ProductTrendPoint>(
    [
      ["activeUsers", metricSeriesByDate(snapshots, "active_users", "ga4")],
      ["newUsers", metricSeriesByDate(snapshots, "new_users", "ga4")],
      [
        "diagnosticsStarted",
        metricSeriesByDate(snapshots, "core_diagnostics_created", "core_app"),
      ],
      [
        "diagnosticsCompleted",
        metricSeriesByDate(snapshots, "core_diagnostics_completed", "core_app"),
      ],
    ],
    (date) => ({
      date,
      activeUsers: 0,
      newUsers: 0,
      diagnosticsStarted: 0,
      diagnosticsCompleted: 0,
    }),
    range,
  );
}

function buildRevenueTrend(
  snapshots: MetricSnapshot[],
  range?: ResolvedDashboardRange,
): RevenueTrendPoint[] {
  return buildTrendPoints<RevenueTrendPoint>(
    [
      ["mrr", metricSeriesByDate(snapshots, "mrr", "stripe")],
      [
        "activeSubscriptions",
        metricSeriesByDate(snapshots, "active_subscriptions", "stripe"),
      ],
      ["trials", metricSeriesByDate(snapshots, "trialing_subscriptions", "stripe")],
      [
        "newPaidWorkshops",
        metricSeriesByDate(snapshots, "new_paid_workshops", "stripe"),
      ],
      [
        "churnedSubscriptions",
        metricSeriesByDate(snapshots, "churned_subscriptions", "stripe"),
      ],
    ],
    (date) => ({
      date,
      mrr: 0,
      activeSubscriptions: 0,
      trials: 0,
      newPaidWorkshops: 0,
      churnedSubscriptions: 0,
    }),
    range,
  );
}

function buildOperationsTrend(
  snapshots: MetricSnapshot[],
  range?: ResolvedDashboardRange,
): OperationsTrendPoint[] {
  return buildTrendPoints<OperationsTrendPoint>(
    [
      [
        "diagnosticsCreated",
        metricSeriesByDate(snapshots, "core_diagnostics_created", "core_app"),
      ],
      [
        "diagnosticsCompleted",
        metricSeriesByDate(snapshots, "core_diagnostics_completed", "core_app"),
      ],
      [
        "diagnosticCost",
        metricSeriesByDate(snapshots, "core_diagnostic_cost", "core_app"),
      ],
      [
        "chatSessions",
        metricSeriesByDate(snapshots, "core_diagnostic_chats", "core_app"),
      ],
      [
        "chatMessages",
        metricSeriesByDate(snapshots, "core_chat_messages", "core_app"),
      ],
      ["chatCost", metricSeriesByDate(snapshots, "core_chat_cost", "core_app")],
    ],
    (date) => ({
      date,
      diagnosticsCreated: 0,
      diagnosticsCompleted: 0,
      diagnosticCost: 0,
      chatSessions: 0,
      chatMessages: 0,
      chatCost: 0,
    }),
    range,
  );
}

function buildAcquisitionCampaigns(
  snapshots: MetricSnapshot[],
): AcquisitionCampaign[] {
  const campaignMap = new Map<string, AcquisitionCampaign>();

  for (const row of snapshots) {
    if (row.source_key !== "google_ads" || row.dimension_key === "total") {
      continue;
    }

    const campaign = asString(row.dimensions.campaign) ?? "Unknown";
    const campaignId = asString(row.dimensions.campaign_id);
    const reportingSource = asString(row.dimensions.reporting_source);
    const key = `${campaignId ?? campaign}:${reportingSource ?? "direct"}`;
    const current =
      campaignMap.get(key) ??
      ({
        campaign,
        campaignId,
        reportingSource,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        cpc: 0,
        ctr: 0,
        conversionRate: 0,
        shareOfSpend: 0,
        shareOfConversions: 0,
      } satisfies AcquisitionCampaign);

    const value = Number(row.value);
    if (row.metric_key === "ad_spend") current.spend += value;
    if (row.metric_key === "ad_clicks") current.clicks += value;
    if (row.metric_key === "ad_impressions") current.impressions += value;
    if (row.metric_key === "ad_signups") current.conversions += value;

    campaignMap.set(key, current);
  }

  const totalSpend = [...campaignMap.values()].reduce(
    (sum, campaign) => sum + campaign.spend,
    0,
  );
  const totalConversions = [...campaignMap.values()].reduce(
    (sum, campaign) => sum + campaign.conversions,
    0,
  );

  return [...campaignMap.values()]
    .filter(
      (campaign) =>
        campaign.spend > 0 ||
        campaign.clicks > 0 ||
        campaign.conversions > 0 ||
        campaign.impressions > 0,
    )
    .map((campaign) => ({
      ...campaign,
      cpc: campaign.clicks ? campaign.spend / campaign.clicks : 0,
      ctr: safeRate(campaign.clicks, campaign.impressions),
      conversionRate: safeRate(campaign.conversions, campaign.clicks),
      shareOfSpend: safeRate(campaign.spend, totalSpend),
      shareOfConversions: safeRate(campaign.conversions, totalConversions),
    }))
    .sort(
      (left, right) =>
        right.spend - left.spend ||
        right.conversions - left.conversions ||
        left.campaign.localeCompare(right.campaign),
    );
}

function buildLifecycleCampaigns(
  snapshots: MetricSnapshot[],
): LifecycleCampaign[] {
  const campaignMap = new Map<string, LifecycleCampaign>();

  for (const row of snapshots) {
    if (row.source_key !== "customer_io" || row.dimension_key === "total") {
      continue;
    }

    const campaign = asString(row.dimensions.campaign) ?? "Unknown";
    const campaignId = asString(row.dimensions.campaign_id);
    const campaignState = asString(row.dimensions.campaign_state);
    const campaignType = asString(row.dimensions.campaign_type);
    const key = `${campaignId ?? campaign}:${campaignState ?? "unknown"}`;
    const current =
      campaignMap.get(key) ??
      ({
        campaign,
        campaignId,
        campaignState,
        campaignType,
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        converted: 0,
        bounced: 0,
        unsubscribed: 0,
        openRate: 0,
        clickRate: 0,
        conversionRate: 0,
        bounceRate: 0,
        unsubscribeRate: 0,
      } satisfies LifecycleCampaign);

    const value = Number(row.value);
    if (row.metric_key === "cio_sent") current.sent += value;
    if (row.metric_key === "cio_delivered") current.delivered += value;
    if (row.metric_key === "cio_human_opened") current.opened += value;
    if (row.metric_key === "cio_human_clicked") current.clicked += value;
    if (row.metric_key === "cio_converted") current.converted += value;
    if (row.metric_key === "cio_bounced") current.bounced += value;
    if (row.metric_key === "cio_unsubscribed") current.unsubscribed += value;

    campaignMap.set(key, current);
  }

  return [...campaignMap.values()]
    .filter(
      (campaign) =>
        campaign.sent > 0 ||
        campaign.opened > 0 ||
        campaign.clicked > 0 ||
        campaign.converted > 0,
    )
    .map((campaign) => ({
      ...campaign,
      openRate: safeRate(campaign.opened, campaign.delivered || campaign.sent),
      clickRate: safeRate(campaign.clicked, campaign.delivered || campaign.sent),
      conversionRate: safeRate(
        campaign.converted,
        campaign.delivered || campaign.sent,
      ),
      bounceRate: safeRate(campaign.bounced, campaign.sent),
      unsubscribeRate: safeRate(campaign.unsubscribed, campaign.delivered),
    }))
    .sort(
      (left, right) =>
        right.sent - left.sent ||
        right.converted - left.converted ||
        left.campaign.localeCompare(right.campaign),
    );
}

function buildMotorUsageBreakdown(
  snapshots: MetricSnapshot[],
): MotorUsageBreakdown[] {
  const databaseMap = new Map<string, MotorUsageBreakdown>();

  for (const row of snapshots) {
    if (row.source_key !== "core_app" || row.dimension_key === "total") {
      continue;
    }

    if (
      row.metric_key !== "core_motor_accesses" &&
      row.metric_key !== "core_motor_unique_users" &&
      row.metric_key !== "core_motor_unique_vehicles"
    ) {
      continue;
    }

    const database = asString(row.dimensions.database) ?? "Unknown";
    const current =
      databaseMap.get(database) ??
      ({
        database,
        accesses: 0,
        uniqueUsers: 0,
        uniqueVehicles: 0,
      } satisfies MotorUsageBreakdown);
    const value = Number(row.value);

    if (row.metric_key === "core_motor_accesses") current.accesses += value;
    if (row.metric_key === "core_motor_unique_users") current.uniqueUsers += value;
    if (row.metric_key === "core_motor_unique_vehicles") {
      current.uniqueVehicles += value;
    }

    databaseMap.set(database, current);
  }

  return [...databaseMap.values()].sort(
    (left, right) =>
      right.accesses - left.accesses ||
      right.uniqueUsers - left.uniqueUsers ||
      left.database.localeCompare(right.database),
  );
}

function buildOperationsSummary(snapshots: MetricSnapshot[]): OperationsSummary {
  const diagnosticsCreated = sumMetric(
    snapshots,
    "core_diagnostics_created",
    "core_app",
  );
  const diagnosticsCompleted = sumMetric(
    snapshots,
    "core_diagnostics_completed",
    "core_app",
  );
  const diagnosticCost = sumMetric(
    snapshots,
    "core_diagnostic_cost",
    "core_app",
  );
  const chatSessions = sumMetric(
    snapshots,
    "core_diagnostic_chats",
    "core_app",
  );
  const chatMessages = sumMetric(snapshots, "core_chat_messages", "core_app");
  const chatCost = sumMetric(snapshots, "core_chat_cost", "core_app");
  const motorAccesses = sumMetric(snapshots, "core_motor_accesses", "core_app");
  const motorUniqueUsers = sumMetric(
    snapshots,
    "core_motor_unique_users",
    "core_app",
  );
  const motorUniqueVehicles = sumMetric(
    snapshots,
    "core_motor_unique_vehicles",
    "core_app",
  );

  return {
    totalUsers: latestMetricValue(snapshots, "core_users", "core_app"),
    totalWorkshops: latestMetricValue(snapshots, "core_workshops", "core_app"),
    diagnosticsCreated,
    diagnosticsCompleted,
    completionRate: safeRate(diagnosticsCompleted, diagnosticsCreated),
    diagnosticCost,
    costPerDiagnostic: diagnosticsCreated ? diagnosticCost / diagnosticsCreated : 0,
    chatSessions,
    chatMessages,
    chatCost,
    costPerChatSession: chatSessions ? chatCost / chatSessions : 0,
    messagesPerChatSession: chatSessions ? chatMessages / chatSessions : 0,
    motorAccesses,
    motorUniqueUsers,
    motorUniqueVehicles,
    aiTotalCostSnapshot: latestMetricValue(
      snapshots,
      "core_ai_total_cost",
      "core_app",
    ),
    aiDiagnosticsCostSnapshot: latestMetricValue(
      snapshots,
      "core_ai_diagnostics_total_cost",
      "core_app",
    ),
    aiChatCostSnapshot: latestMetricValue(
      snapshots,
      "core_ai_chat_total_cost",
      "core_app",
    ),
    aiChatAdoptionRate: normalizeStoredPercent(
      latestMetricValue(snapshots, "core_ai_chat_adoption_rate", "core_app"),
    ),
  };
}

function normalizeSubscriptionStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? null;
  if (!normalized) return null;

  return normalized;
}

function primaryStripeStatus(rows: WarehouseSubscription[]) {
  const priority = new Map<string, number>([
    ["active", 0],
    ["trialing", 1],
    ["paused", 2],
    ["past_due", 3],
    ["unpaid", 4],
    ["incomplete", 5],
    ["incomplete_expired", 6],
    ["canceled", 7],
  ]);

  const statuses = rows
    .map((row) => normalizeSubscriptionStatus(row.status))
    .filter((status): status is string => Boolean(status))
    .sort(
      (left, right) =>
        (priority.get(left) ?? 99) - (priority.get(right) ?? 99),
    );

  return statuses[0] ?? null;
}

function workshopStatusBucket(status: string | null): keyof Pick<
  WorkshopSnapshot,
  "active" | "trialing" | "paused" | "atRisk" | "inactive" | "unknown"
> {
  switch (normalizeSubscriptionStatus(status)) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "paused":
      return "paused";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return "atRisk";
    case "inactive":
    case "canceled":
      return "inactive";
    default:
      return "unknown";
  }
}

function buildWorkshopSnapshot(
  workshops: WarehouseWorkshop[],
  subscriptions: WarehouseSubscription[],
): WorkshopSnapshot {
  const subscriptionsByWorkshop = new Map<string, WarehouseSubscription[]>();
  const countryCounts = new Map<string, number>();

  for (const subscription of subscriptions) {
    if (!subscription.workshop_id) continue;

    const current = subscriptionsByWorkshop.get(subscription.workshop_id) ?? [];
    current.push(subscription);
    subscriptionsByWorkshop.set(subscription.workshop_id, current);
  }

  const snapshot: WorkshopSnapshot = {
    total: workshops.length,
    live: 0,
    active: 0,
    trialing: 0,
    paused: 0,
    atRisk: 0,
    inactive: 0,
    unknown: 0,
    stripeLinked: 0,
    withCountry: 0,
    topCountries: [],
    sources: {
      stripe: 0,
      customerIo: 0,
      unknown: 0,
    },
  };

  for (const workshop of workshops) {
    const workshopSubscriptions =
      subscriptionsByWorkshop.get(workshop.workshop_id) ?? [];
    const metadata = workshop.metadata ?? {};
    const stripeStatus = primaryStripeStatus(workshopSubscriptions);
    const customerIoStatus = asString(metadata.subscription_status);
    const resolvedStatus = stripeStatus ?? customerIoStatus ?? null;
    const bucket = workshopStatusBucket(resolvedStatus);

    snapshot[bucket] += 1;

    if (stripeStatus) {
      snapshot.sources.stripe += 1;
    } else if (customerIoStatus) {
      snapshot.sources.customerIo += 1;
    } else {
      snapshot.sources.unknown += 1;
    }

    if (
      workshopSubscriptions.length > 0 ||
      asString(metadata.stripe_customer_id)
    ) {
      snapshot.stripeLinked += 1;
    }

    if (workshop.country) {
      snapshot.withCountry += 1;
      countryCounts.set(
        workshop.country,
        (countryCounts.get(workshop.country) ?? 0) + 1,
      );
    }
  }

  snapshot.live = snapshot.active + snapshot.trialing;
  snapshot.topCountries = [...countryCounts.entries()]
    .map(([country, count]) => ({ country, workshops: count }))
    .sort(
      (left, right) =>
        right.workshops - left.workshops ||
        left.country.localeCompare(right.country),
    )
    .slice(0, 5);

  return snapshot;
}

function normalizeStatus(value: string | null) {
  return value ? value.trim().toLowerCase() : null;
}

function buildEnrichmentCoverage(
  users: WarehouseUser[],
  workshops: WarehouseWorkshop[],
  subscriptions: WarehouseSubscription[],
): EnrichmentCoverage {
  // Drift detection: count workshops where the core_app's subscription_status
  // disagrees with the most-recent Stripe subscription row. Both must be
  // present for it to count as drift (a missing core value is a coverage
  // gap, not drift).
  const stripeStatusByWorkshop = new Map<string, string>();
  for (const subscription of subscriptions) {
    if (!subscription.workshop_id) continue;
    // Stripe rows are already filtered to current period; for drift we just
    // compare the latest known status by workshop, preferring active states.
    const existing = stripeStatusByWorkshop.get(subscription.workshop_id);
    if (!existing || subscription.status === "active") {
      stripeStatusByWorkshop.set(subscription.workshop_id, subscription.status);
    }
  }
  let workshopsWithSubscriptionStatusDrift = 0;
  for (const workshop of workshops) {
    const core = normalizeStatus(workshop.core_subscription_status);
    const stripe = normalizeStatus(
      stripeStatusByWorkshop.get(workshop.workshop_id) ?? null,
    );
    if (core && stripe && core !== stripe) {
      workshopsWithSubscriptionStatusDrift += 1;
    }
  }

  return {
    usersWithCustomerIoId: users.filter((user) => user.customer_io_id).length,
    usersWithCreatedAt: users.filter((user) => user.created_at).length,
    usersWithSubscriptionStatus: users.filter((user) =>
      asString(user.metadata?.subscription_status),
    ).length,
    usersWithStripeCustomerId: users.filter((user) =>
      asString(user.metadata?.stripe_customer_id),
    ).length,
    usersWithCoreStripeCustomerId: users.filter(
      (user) => user.core_stripe_customer_id,
    ).length,
    usersWithName: users.filter((user) => user.name).length,
    workshopsWithCountry: workshops.filter((workshop) => workshop.country).length,
    workshopsWithSubscriptionStatus: workshops.filter((workshop) =>
      asString(workshop.metadata?.subscription_status),
    ).length,
    workshopsWithStripeCustomerId: workshops.filter((workshop) =>
      asString(workshop.metadata?.stripe_customer_id),
    ).length,
    workshopsWithLanguage: workshops.filter((workshop) => workshop.language).length,
    workshopsWithCoreStripeCustomerId: workshops.filter(
      (workshop) => workshop.core_stripe_customer_id,
    ).length,
    workshopsWithCreatedByAgent: workshops.filter(
      (workshop) => workshop.created_by_agent !== null,
    ).length,
    workshopsWithSubscriptionStatusDrift,
  };
}

function firstMetricStart(snapshots: MetricSnapshot[]) {
  return snapshots
    .map((snapshot) => snapshot.period_start)
    .sort((left, right) => left.localeCompare(right))[0];
}

function readablePlanName(plan: string) {
  const normalized = plan.trim();
  if (!normalized) {
    return "Unknown";
  }

  if (normalized.startsWith("price_")) {
    return `Price ${normalized.slice(-6)}`;
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

export function calculateDashboardData({
  snapshots,
  funnelSnapshots,
  syncRuns,
  users = [],
  workshops = [],
  subscriptions = [],
  range,
  setupMode = false,
  now = new Date(),
}: {
  snapshots: MetricSnapshot[];
  funnelSnapshots: FunnelSnapshot[];
  syncRuns: SyncRun[];
  users?: WarehouseUser[];
  workshops?: WarehouseWorkshop[];
  subscriptions?: WarehouseSubscription[];
  range?: ResolvedDashboardRange;
  setupMode?: boolean;
  now?: Date;
}): DashboardData {
  const resolvedRange =
    range ?? resolveDashboardTimeRange(DEFAULT_TIME_RANGE_KEY, now);
  const earliestMetric = firstMetricStart(snapshots);
  const mrr = latestMetric(snapshots, "mrr", "stripe");
  const activeSubscriptions = latestMetric(
    snapshots,
    "active_subscriptions",
    "stripe",
  );
  const trials = latestMetric(snapshots, "trialing_subscriptions", "stripe");
  const newPaidWorkshops = sumMetric(
    snapshots,
    "new_paid_workshops",
    "stripe",
  );
  const churnedSubscriptions = sumMetric(
    snapshots,
    "churned_subscriptions",
    "stripe",
  );
  const adSpend = sumMetric(snapshots, "ad_spend", "google_ads");
  const clicks = sumMetric(snapshots, "ad_clicks", "google_ads");
  const impressions = sumMetric(snapshots, "ad_impressions", "google_ads");
  const adSignups = sumMetric(snapshots, "ad_signups", "google_ads");
  const activeUsers = sumMetric(snapshots, "active_users", "ga4");
  const newUsers = sumMetric(snapshots, "new_users", "ga4");
  const diagnosticsStarted = metricValueOrFallback(
    snapshots,
    "core_diagnostics_created",
    "core_app",
    "diagnostic_started",
    "ga4",
  );
  const diagnosticsCompleted = metricValueOrFallback(
    snapshots,
    "core_diagnostics_completed",
    "core_app",
    "diagnostic_completed",
    "ga4",
  );
  const activatedWorkshops = sumMetric(
    snapshots,
    "activated_workshop",
    "ga4",
  );
  const signups = sumMetric(snapshots, "signup", "ga4");
  const cac = newPaidWorkshops ? adSpend / newPaidWorkshops : 0;
  const activationRate = safeRate(activatedWorkshops, signups || newUsers);
  const funnel = buildFunnel(snapshots, funnelSnapshots);
  const paidConversion = safeRate(
    funnel.at(-1)?.value ?? 0,
    funnel[0]?.value ?? 0,
  );
  const acquisitionTrend = buildAcquisitionTrend(snapshots, resolvedRange);
  const organicTrend = buildOrganicTrend(snapshots, resolvedRange);
  const productTrend = buildProductTrend(snapshots, resolvedRange);
  const revenueTrend = buildRevenueTrend(snapshots, resolvedRange);
  const operationsTrend = buildOperationsTrend(snapshots, resolvedRange);
  const acquisitionCampaigns = buildAcquisitionCampaigns(snapshots);
  const lifecycleCampaigns = buildLifecycleCampaigns(snapshots);
  const motorUsage = buildMotorUsageBreakdown(snapshots);
  const operations = buildOperationsSummary(snapshots);
  const organic = buildOrganicSummary(snapshots);
  const workshopSnapshot = buildWorkshopSnapshot(workshops, subscriptions);
  const enrichmentCoverage = buildEnrichmentCoverage(
    users,
    workshops,
    subscriptions,
  );
  const recentSyncRuns = buildRecentSyncRuns(syncRuns);

  const lifecycle = {
    sent: sumMetric(snapshots, "cio_sent", "customer_io"),
    delivered: sumMetric(snapshots, "cio_delivered", "customer_io"),
    humanOpened: sumMetric(snapshots, "cio_human_opened", "customer_io"),
    clicked: sumMetric(snapshots, "cio_clicked", "customer_io"),
    humanClicked: sumMetric(snapshots, "cio_human_clicked", "customer_io"),
    converted: sumMetric(snapshots, "cio_converted", "customer_io"),
    unsubscribed: sumMetric(snapshots, "cio_unsubscribed", "customer_io"),
    bounced: sumMetric(snapshots, "cio_bounced", "customer_io"),
  };

  const executive: KpiCard[] = [
    {
      label: "MRR",
      value: formatCurrency(mrr),
      rawValue: mrr,
      hint: `${formatCurrency(mrr * 12)} ARR run-rate`,
      tone: "revenue",
    },
    {
      label: "Live workshops",
      value: formatNumber(workshopSnapshot.live),
      rawValue: workshopSnapshot.live,
      hint: `${formatNumber(workshopSnapshot.active)} active + ${formatNumber(workshopSnapshot.trialing)} trialing`,
      tone: "growth",
    },
    {
      label: "Active users",
      value: compactNumber(activeUsers),
      rawValue: activeUsers,
      hint: `${formatNumber(newUsers)} new users in window`,
      tone: "product",
    },
    {
      label: "Diagnostics completed",
      value: compactNumber(diagnosticsCompleted),
      rawValue: diagnosticsCompleted,
      hint: `${formatPercent(safeRate(diagnosticsCompleted, diagnosticsStarted))} completion rate`,
      tone: "product",
    },
    {
      label: "Paid conversion",
      value: formatPercent(paidConversion),
      rawValue: paidConversion,
      hint: "From top of funnel to paid",
      tone: "growth",
    },
    {
      label: "CAC",
      value: cac ? formatCurrency(cac) : "Pending",
      rawValue: cac,
      hint: `${formatCurrency(adSpend)} tracked spend`,
      tone: cac ? "neutral" : "warning",
    },
  ];

  const sources = buildSourceHealth(syncRuns, now);
  const staleSources = sources.filter((source) => source.status !== "healthy");
  const insights = [
    staleSources.length
      ? `${staleSources.length} source${staleSources.length === 1 ? "" : "s"} need attention before numbers are fully trusted.`
      : "All configured sources refreshed recently.",
    activationRate
      ? `${formatPercent(activationRate)} of signups reached activated workshop in the selected window.`
      : "Activation rate will appear after signup and activation events are mapped.",
    organic.clicks > 0
      ? `${formatNumber(organic.clicks)} organic Search Console clicks and ${compactNumber(organic.impressions)} impressions were captured in this window.`
      : "Organic search reporting will appear after Search Console syncs land.",
    workshopSnapshot.unknown > 0
      ? `${formatNumber(workshopSnapshot.unknown)} tracked workshops still have no subscription-state coverage from Stripe yet.`
      : "Every tracked workshop has a current subscription-state snapshot.",
    workshopSnapshot.atRisk + workshopSnapshot.paused > 0
      ? `${formatNumber(workshopSnapshot.paused + workshopSnapshot.atRisk)} workshops are paused or at risk and may need retention attention.`
      : churnedSubscriptions > activeSubscriptions * 0.05
        ? "Churn risk is elevated relative to the active subscription base."
        : "No elevated churn signal in the current snapshot.",
  ];

  return {
    setupMode,
    generatedAt: now.toISOString(),
    windowLabel: resolvedRange.label,
    dateSpan: formatRangeDateSpan(resolvedRange, earliestMetric),
    selectedRange: resolvedRange.key,
    timeRangeOptions: getDashboardTimeRangeOptions(resolvedRange.key),
    hasLimitedHistory: snapshots.length === 0 || !earliestMetric,
    executive,
    funnel,
    sources,
    recentSyncRuns,
    performance: buildPerformanceSeries(snapshots),
    acquisitionTrend,
    organicTrend,
    productTrend,
    revenueTrend,
    operationsTrend,
    acquisitionCampaigns,
    lifecycleCampaigns,
    motorUsage,
    operations,
    workshopSnapshot,
    enrichmentCoverage,
    marketing: {
      spend: adSpend,
      clicks,
      impressions,
      conversions: adSignups,
      cpc: clicks ? adSpend / clicks : 0,
      cac,
    },
    organic,
    product: {
      activeUsers,
      newUsers,
      diagnosticsStarted,
      diagnosticsCompleted,
      activationRate,
      platformSplit: buildPlatformSplit(snapshots),
    },
    lifecycle,
    revenue: {
      mrr,
      arr: mrr * 12,
      activeSubscriptions,
      trials,
      newPaidWorkshops,
      churnedSubscriptions,
      planMix: buildPlanMix(snapshots),
    },
    insights,
  };
}

function buildPlanMix(snapshots: MetricSnapshot[]) {
  const rows = metricRows(snapshots, "plan_subscriptions", "stripe").filter(
    (row) => row.dimension_key !== "total",
  );

  return rows
    .map((row) => ({
      plan: readablePlanName(String(row.dimensions.plan ?? "unknown")),
      subscriptions: Number(row.value),
    }))
    .sort((left, right) => right.subscriptions - left.subscriptions);
}

function demoSnapshot(
  source_key: SourceKey,
  metric_key: string,
  value: number,
  dimensions: Record<string, string | number | boolean | null> = {},
): MetricSnapshot {
  const now = new Date();
  const dimension_key =
    Object.keys(dimensions).length === 0
      ? "total"
      : Object.entries(dimensions)
          .map(([key, item]) => `${key}:${String(item)}`)
          .join("|");

  return {
    source_key,
    metric_key,
    period_start: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    period_end: now.toISOString(),
    dimension_key,
    dimensions,
    value,
    unit: metric_key.includes("spend") || metric_key === "mrr" ? "currency" : "count",
    currency: "USD",
    collected_at: now.toISOString(),
  };
}

export function getDemoDashboardData(
  range?: ResolvedDashboardRange,
  now = new Date(),
): DashboardData {
  const resolvedRange =
    range ?? resolveDashboardTimeRange(DEFAULT_TIME_RANGE_KEY, now);
  const snapshots: MetricSnapshot[] = [
    demoSnapshot("core_app", "core_users", 326),
    demoSnapshot("core_app", "core_workshops", 243),
    demoSnapshot("core_app", "core_diagnostics_created", 188),
    demoSnapshot("core_app", "core_diagnostics_completed", 142),
    demoSnapshot("core_app", "core_diagnostic_cost", 1320.45),
    demoSnapshot("core_app", "core_diagnostic_chats", 54),
    demoSnapshot("core_app", "core_chat_messages", 238),
    demoSnapshot("core_app", "core_chat_cost", 118.42),
    demoSnapshot("core_app", "core_ai_total_cost", 18969.5),
    demoSnapshot("core_app", "core_ai_diagnostics_total_cost", 18043.1),
    demoSnapshot("core_app", "core_ai_chat_total_cost", 926.4),
    demoSnapshot("core_app", "core_ai_chat_adoption_rate", 12.5),
    demoSnapshot("core_app", "core_motor_accesses", 620, { database: "OEM" }),
    demoSnapshot("core_app", "core_motor_accesses", 410, { database: "WIRING" }),
    demoSnapshot("core_app", "core_motor_accesses", 180, { database: "LOCATIONS" }),
    demoSnapshot("core_app", "core_motor_unique_users", 118, { database: "OEM" }),
    demoSnapshot("core_app", "core_motor_unique_users", 84, { database: "WIRING" }),
    demoSnapshot("core_app", "core_motor_unique_users", 52, { database: "LOCATIONS" }),
    demoSnapshot("core_app", "core_motor_unique_vehicles", 222, { database: "OEM" }),
    demoSnapshot("core_app", "core_motor_unique_vehicles", 164, { database: "WIRING" }),
    demoSnapshot("core_app", "core_motor_unique_vehicles", 88, { database: "LOCATIONS" }),
    demoSnapshot("stripe", "mrr", 8400),
    demoSnapshot("stripe", "active_subscriptions", 62),
    demoSnapshot("stripe", "trialing_subscriptions", 18),
    demoSnapshot("stripe", "new_paid_workshops", 11),
    demoSnapshot("stripe", "churned_subscriptions", 2),
    demoSnapshot("stripe", "plan_subscriptions", 25, { plan: "Workshop Small" }),
    demoSnapshot("stripe", "plan_subscriptions", 37, { plan: "Workshop Large" }),
    demoSnapshot("google_ads", "ad_spend", 3200),
    demoSnapshot("google_ads", "ad_clicks", 1840),
    demoSnapshot("google_ads", "ad_impressions", 126000),
    demoSnapshot("google_ads", "ad_conversions", 93),
    demoSnapshot("google_ads", "ad_signups", 56),
    demoSnapshot("search_console", "organic_search_clicks", 1440),
    demoSnapshot("search_console", "organic_search_impressions", 83200),
    demoSnapshot("search_console", "organic_search_ctr", 1.73),
    demoSnapshot("search_console", "organic_search_position", 14.8),
    demoSnapshot("search_console", "organic_search_clicks", 420, {
      query: "wrenchlane",
    }),
    demoSnapshot("search_console", "organic_search_impressions", 3200, {
      query: "wrenchlane",
    }),
    demoSnapshot("search_console", "organic_search_position", 4.6, {
      query: "wrenchlane",
    }),
    demoSnapshot("search_console", "organic_search_clicks", 260, {
      query: "car diagnostic app",
    }),
    demoSnapshot("search_console", "organic_search_impressions", 6100, {
      query: "car diagnostic app",
    }),
    demoSnapshot("search_console", "organic_search_position", 10.3, {
      query: "car diagnostic app",
    }),
    demoSnapshot("search_console", "organic_search_clicks", 310, {
      page: "https://www.wrenchlane.com/",
    }),
    demoSnapshot("search_console", "organic_search_impressions", 18400, {
      page: "https://www.wrenchlane.com/",
    }),
    demoSnapshot("search_console", "organic_search_position", 8.2, {
      page: "https://www.wrenchlane.com/",
    }),
    demoSnapshot("search_console", "organic_search_clicks", 510, {
      device: "mobile",
    }),
    demoSnapshot("search_console", "organic_search_impressions", 42100, {
      device: "mobile",
    }),
    demoSnapshot("search_console", "organic_search_position", 12.6, {
      device: "mobile",
    }),
    demoSnapshot("search_console", "organic_search_clicks", 640, {
      country: "SE",
    }),
    demoSnapshot("search_console", "organic_search_impressions", 21400, {
      country: "SE",
    }),
    demoSnapshot("search_console", "organic_search_position", 6.9, {
      country: "SE",
    }),
    demoSnapshot("google_ads", "ad_spend", 1820, {
      campaign: "US Generic",
      campaign_id: "ga-us-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_clicks", 930, {
      campaign: "US Generic",
      campaign_id: "ga-us-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_impressions", 52000, {
      campaign: "US Generic",
      campaign_id: "ga-us-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_conversions", 48, {
      campaign: "US Generic",
      campaign_id: "ga-us-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_signups", 32, {
      campaign: "US Generic",
      campaign_id: "ga-us-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_spend", 980, {
      campaign: "UK Generic",
      campaign_id: "ga-uk-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_clicks", 640, {
      campaign: "UK Generic",
      campaign_id: "ga-uk-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_impressions", 41000, {
      campaign: "UK Generic",
      campaign_id: "ga-uk-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_conversions", 34, {
      campaign: "UK Generic",
      campaign_id: "ga-uk-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("google_ads", "ad_signups", 22, {
      campaign: "UK Generic",
      campaign_id: "ga-uk-1",
      reporting_source: "ga4_linked_google_ads",
    }),
    demoSnapshot("ga4", "sessions", 9800),
    demoSnapshot("ga4", "signup", 420),
    demoSnapshot("ga4", "onboarding_completed", 260),
    demoSnapshot("ga4", "first_diagnostic_started", 188),
    demoSnapshot("ga4", "diagnostic_started", 640),
    demoSnapshot("ga4", "diagnostic_completed", 512),
    demoSnapshot("ga4", "activated_workshop", 72),
    demoSnapshot("ga4", "active_users", 1240, { platform: "web" }),
    demoSnapshot("ga4", "active_users", 820, { platform: "android" }),
    demoSnapshot("ga4", "active_users", 610, { platform: "ios" }),
    demoSnapshot("ga4", "new_users", 560),
    demoSnapshot("customer_io", "cio_sent", 8800),
    demoSnapshot("customer_io", "cio_delivered", 8460),
    demoSnapshot("customer_io", "cio_human_opened", 3160),
    demoSnapshot("customer_io", "cio_clicked", 980),
    demoSnapshot("customer_io", "cio_human_clicked", 760),
    demoSnapshot("customer_io", "cio_converted", 128),
    demoSnapshot("customer_io", "cio_unsubscribed", 23),
    demoSnapshot("customer_io", "cio_bounced", 41),
    demoSnapshot("customer_io", "cio_sent", 3400, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_delivered", 3260, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_human_opened", 1420, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_human_clicked", 410, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_converted", 62, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_bounced", 12, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_unsubscribed", 8, {
      campaign: "Welcome Flow",
      campaign_id: 101,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_sent", 1900, {
      campaign: "Trial Nudge",
      campaign_id: 202,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_delivered", 1860, {
      campaign: "Trial Nudge",
      campaign_id: 202,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_human_opened", 620, {
      campaign: "Trial Nudge",
      campaign_id: 202,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_human_clicked", 180, {
      campaign: "Trial Nudge",
      campaign_id: 202,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("customer_io", "cio_converted", 28, {
      campaign: "Trial Nudge",
      campaign_id: 202,
      campaign_state: "running",
      campaign_type: "event",
    }),
    demoSnapshot("app_store_connect", "app_store_impressions", 23000),
    demoSnapshot("app_store_connect", "app_store_page_views", 4100),
    demoSnapshot("app_store_connect", "app_store_downloads", 630),
  ];
  const syncRuns: SyncRun[] = SOURCE_KEYS.map((sourceKey, index) => ({
    source_key: sourceKey,
    status: index < 3 ? "success" : "skipped",
    started_at: new Date(now.getTime() - index * 1_800_000).toISOString(),
    completed_at:
      index < 3
        ? new Date(now.getTime() - index * 1_800_000 + 30_000).toISOString()
        : null,
    rows_read: 25,
    rows_written: 25,
    error_message: null,
  }));

  return calculateDashboardData({
    snapshots,
    funnelSnapshots: [],
    syncRuns,
    users: [
      {
        internal_user_id: "demo-1",
        workshop_id: "w-1",
        customer_io_id: "cio-1",
        created_at: "2026-03-18T00:00:00.000Z",
        last_seen_at: "2026-04-23T08:00:00.000Z",
        name: null,
        phone: null,
        core_stripe_customer_id: null,
        metadata: {
          country: "SE",
          stripe_customer_id: "cus_1",
          subscription_status: "active",
        },
      },
    ],
    workshops: [
      {
        workshop_id: "w-1",
        name: "Workshop Large Demo",
        country: "SE",
        plan_key: "Workshop Large",
        created_at: "2026-03-18T00:00:00.000Z",
        activated_at: "2026-03-23T00:00:00.000Z",
        language: null,
        core_subscription_status: null,
        payment_status: null,
        trial_end: null,
        created_by_agent: null,
        core_stripe_customer_id: null,
        core_stripe_subscription_id: null,
        metadata: {
          stripe_customer_id: "cus_1",
          subscription_status: "active",
        },
      },
      {
        workshop_id: "w-2",
        name: "Workshop Small Demo",
        country: "GB",
        plan_key: "Workshop Small",
        created_at: "2026-03-26T00:00:00.000Z",
        activated_at: null,
        language: null,
        core_subscription_status: null,
        payment_status: null,
        trial_end: null,
        created_by_agent: null,
        core_stripe_customer_id: null,
        core_stripe_subscription_id: null,
        metadata: {
          subscription_status: "trialing",
        },
      },
      {
        workshop_id: "w-3",
        name: "Workshop Prospect Demo",
        country: "US",
        plan_key: "Workshop Small",
        created_at: "2026-04-04T00:00:00.000Z",
        activated_at: null,
        language: null,
        core_subscription_status: null,
        payment_status: null,
        trial_end: null,
        created_by_agent: null,
        core_stripe_customer_id: null,
        core_stripe_subscription_id: null,
        metadata: {},
      },
    ],
    subscriptions: [
      {
        workshop_id: "w-1",
        stripe_customer_id: "cus_1",
        status: "active",
        plan_key: "Workshop Large",
        current_period_start: "2026-04-01T00:00:00.000Z",
        current_period_end: "2026-05-01T00:00:00.000Z",
        trial_end: null,
        cancel_at: null,
        canceled_at: null,
      },
    ],
    range: resolvedRange,
    setupMode: true,
    now,
  });
}
