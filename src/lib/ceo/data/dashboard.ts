import { unstable_cache } from "next/cache";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
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
import { pageAll } from "@/lib/supabase-paging";
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

async function getDashboardDataUncached(
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

    const startIso = range.start?.toISOString();
    const endIso = range.end.toISOString();

    const [
      metricsResult,
      funnelResult,
      syncRunsResult,
      usersResult,
      workshopsResult,
      subscriptionsResult,
    ] = await Promise.all([
      pageAll<unknown>(({ from, to }) => {
        let q = supabase
          .from(TABLES.metricSnapshots)
          .select("*")
          .lt("period_start", endIso)
          .order("period_start", { ascending: false })
          .range(from, to);
        if (startIso) q = q.gte("period_start", startIso);
        return q;
      }),
      pageAll<unknown>(({ from, to }) => {
        let q = supabase
          .from(TABLES.funnelSnapshots)
          .select("*")
          .lt("period_start", endIso)
          .order("period_start", { ascending: false })
          .range(from, to);
        if (startIso) q = q.gte("period_start", startIso);
        return q;
      }),
      supabase
        .from(TABLES.syncRuns)
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50),
      pageAll<WarehouseUser>(({ from, to }) =>
        supabase
          .from(TABLES.users)
          .select(
            "internal_user_id, workshop_id, customer_io_id, created_at, signed_up_at, last_seen_at, name, phone, core_stripe_customer_id, metadata",
          )
          .order("internal_user_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<WarehouseWorkshop>(({ from, to }) =>
        supabase
          .from(TABLES.workshops)
          .select(
            "workshop_id, name, country, plan_key, created_at, activated_at, language, core_subscription_status, payment_status, trial_end, created_by_agent, core_stripe_customer_id, core_stripe_subscription_id, metadata",
          )
          .order("workshop_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<WarehouseSubscription>(({ from, to }) =>
        supabase
          .from(TABLES.subscriptions)
          .select(
            "workshop_id, stripe_customer_id, status, plan_key, current_period_start, current_period_end, trial_end, cancel_at, canceled_at",
          )
          .order("stripe_customer_id", { ascending: true })
          .range(from, to),
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
      snapshots: metricsResult.data.map(normalizeMetricSnapshot),
      funnelSnapshots: funnelResult.data.map(normalizeFunnelSnapshot),
      syncRuns: (syncRunsResult.data ?? []) as SyncRun[],
      users: usersResult.data.map(normalizeUser),
      workshops: workshopsResult.data.map(normalizeWorkshop),
      subscriptions: subscriptionsResult.data,
      range,
    });
  } catch (error) {
    console.error("Dashboard data normalization failed", error);
    return getDemoDashboardData(range);
  }
}

// Cache keyed by the normalized range key (a stable string), tagged so the
// "Update" refresh actions can bust it via revalidateTag(CEO_CACHE_TAG).
const getDashboardDataCached = unstable_cache(
  (rangeKey: string) => getDashboardDataUncached(rangeKey),
  ["ceo-dashboard-data"],
  CEO_CACHE_OPTIONS,
);

export function getDashboardData(
  rangeParam?: string | string[],
): Promise<DashboardData> {
  return getDashboardDataCached(normalizeDashboardTimeRangeKey(rangeParam));
}
