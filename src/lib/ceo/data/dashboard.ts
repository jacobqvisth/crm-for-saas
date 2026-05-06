import { hasSupabaseConfig } from "@/lib/ceo/env";
import {
  calculateDashboardData,
  getDemoDashboardData,
} from "@/lib/ceo/metrics/calculations";
import type {
  DashboardData,
  FunnelSnapshot,
  MetricSnapshot,
  SyncRun,
  WarehouseSubscription,
  WarehouseUser,
  WarehouseWorkshop,
} from "@/lib/ceo/metrics/types";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeMetricSnapshot(row: unknown): MetricSnapshot {
  const snapshot = row as MetricSnapshot;

  return {
    ...snapshot,
    dimensions: isRecord(snapshot.dimensions) ? snapshot.dimensions : {},
    value: Number(snapshot.value ?? 0),
  };
}

function normalizeFunnelSnapshot(row: unknown): FunnelSnapshot {
  const snapshot = row as FunnelSnapshot;

  return {
    ...snapshot,
    dimensions: isRecord(snapshot.dimensions) ? snapshot.dimensions : {},
    count: Number(snapshot.count ?? 0),
  };
}

function normalizeUser(row: unknown): WarehouseUser {
  const user = row as WarehouseUser;

  return {
    ...user,
    metadata: isRecord(user.metadata) ? user.metadata : {},
  };
}

function normalizeWorkshop(row: unknown): WarehouseWorkshop {
  const workshop = row as WarehouseWorkshop;

  return {
    ...workshop,
    metadata: isRecord(workshop.metadata) ? workshop.metadata : {},
  };
}

export async function getDashboardData(
  rangeParam?: string | string[],
): Promise<DashboardData> {
  const rangeKey = normalizeDashboardTimeRangeKey(rangeParam);
  const range = resolveDashboardTimeRange(rangeKey);

  try {
    if (!hasSupabaseConfig()) {
      return getDemoDashboardData(range);
    }

    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return getDemoDashboardData(range);
    }

    let metricsQuery = supabase
      .from(TABLES.metricSnapshots)
      .select("*")
      .lt("period_start", range.end.toISOString())
      .order("period_start", { ascending: false });
    let funnelQuery = supabase
      .from(TABLES.funnelSnapshots)
      .select("*")
      .lt("period_start", range.end.toISOString())
      .order("period_start", { ascending: false });

    if (range.start) {
      metricsQuery = metricsQuery.gte("period_start", range.start.toISOString());
      funnelQuery = funnelQuery.gte("period_start", range.start.toISOString());
    }

    const [
      metricsResult,
      funnelResult,
      syncRunsResult,
      usersResult,
      workshopsResult,
      subscriptionsResult,
    ] = await Promise.all([
      metricsQuery,
      funnelQuery,
      supabase
        .from(TABLES.syncRuns)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50),
      supabase
        .from(TABLES.users)
        .select(
          "internal_user_id, workshop_id, customer_io_id, created_at, last_seen_at, name, phone, core_stripe_customer_id, metadata",
        ),
      supabase
        .from(TABLES.workshops)
        .select(
          "workshop_id, name, country, plan_key, created_at, activated_at, language, core_subscription_status, payment_status, trial_end, created_by_agent, core_stripe_customer_id, core_stripe_subscription_id, metadata",
        ),
      supabase
        .from(TABLES.subscriptions)
        .select(
          "workshop_id, stripe_customer_id, status, plan_key, current_period_start, current_period_end, trial_end, cancel_at, canceled_at",
        ),
    ]);

    if (
      metricsResult.error ||
      funnelResult.error ||
      syncRunsResult.error ||
      usersResult.error ||
      workshopsResult.error ||
      subscriptionsResult.error
    ) {
      console.error("Dashboard read failed", {
        metrics: metricsResult.error,
        funnel: funnelResult.error,
        syncRuns: syncRunsResult.error,
        users: usersResult.error,
        workshops: workshopsResult.error,
        subscriptions: subscriptionsResult.error,
      });

      return getDemoDashboardData(range);
    }

    return calculateDashboardData({
      snapshots: (metricsResult.data ?? []).map(normalizeMetricSnapshot),
      funnelSnapshots: (funnelResult.data ?? []).map(normalizeFunnelSnapshot),
      syncRuns: (syncRunsResult.data ?? []) as SyncRun[],
      users: (usersResult.data ?? []).map(normalizeUser),
      workshops: (workshopsResult.data ?? []).map(normalizeWorkshop),
      subscriptions: (subscriptionsResult.data ?? []) as WarehouseSubscription[],
      range,
    });
  } catch (error) {
    console.error("Dashboard data normalization failed", error);
    return getDemoDashboardData(range);
  }
}
