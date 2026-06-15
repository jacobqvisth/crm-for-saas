import { describe, expect, it } from "vitest";
import { calculateDashboardData, getDemoDashboardData } from "./calculations";
import type {
  MetricSnapshot,
  SyncRun,
  WarehouseSubscription,
  WarehouseUser,
  WarehouseWorkshop,
} from "./types";

function snapshot(metric_key: string, value: number): MetricSnapshot {
  return {
    source_key:
      metric_key.startsWith("core_")
        ? "core_app"
        : metric_key === "mrr" || metric_key.includes("subscriptions")
        ? "stripe"
        : "ga4",
    metric_key,
    period_start: "2026-04-01T00:00:00.000Z",
    period_end: "2026-04-02T00:00:00.000Z",
    dimension_key: "total",
    dimensions: {},
    value,
    unit: "count",
    currency: null,
    collected_at: "2026-04-02T01:00:00.000Z",
  };
}

const workshopDefaults = {
  language: null,
  core_subscription_status: null,
  payment_status: null,
  trial_end: null,
  created_by_agent: null,
  core_stripe_customer_id: null,
  core_stripe_subscription_id: null,
  is_internal_test: false,
  churned_at: null,
};

const workshops: WarehouseWorkshop[] = [
  {
    workshop_id: "w-1",
    name: "Workshop One",
    country: "SE",
    plan_key: "pro",
    created_at: "2026-04-01T00:00:00.000Z",
    activated_at: "2026-04-04T00:00:00.000Z",
    ...workshopDefaults,
    metadata: {
      stripe_customer_id: "cus_1",
      subscription_status: "active",
    },
  },
  {
    workshop_id: "w-2",
    name: "Workshop Two",
    country: "GB",
    plan_key: "starter",
    created_at: "2026-04-02T00:00:00.000Z",
    activated_at: null,
    ...workshopDefaults,
    metadata: {
      subscription_status: "trialing",
    },
  },
  {
    workshop_id: "w-3",
    name: "Workshop Three",
    country: null,
    plan_key: "starter",
    created_at: "2026-04-03T00:00:00.000Z",
    activated_at: null,
    ...workshopDefaults,
    metadata: {},
  },
];

const subscriptions: WarehouseSubscription[] = [
  {
    workshop_id: "w-1",
    stripe_customer_id: "cus_1",
    status: "active",
    plan_key: "pro",
    mrr_amount_cents: 100000,
    currency: "USD",
    current_period_start: null,
    current_period_end: null,
    trial_end: null,
    cancel_at: null,
    canceled_at: null,
    metadata: { ever_paid: true, first_paid_at: "2026-04-04T00:00:00.000Z" },
  },
];

const users: WarehouseUser[] = [
  {
    internal_user_id: "u-1",
    workshop_id: "w-1",
    customer_io_id: "cio-1",
    created_at: "2026-04-01T00:00:00.000Z",
    signed_up_at: "2026-04-01T00:00:00.000Z",
    last_seen_at: "2026-04-20T00:00:00.000Z",
    name: null,
    phone: null,
    core_stripe_customer_id: null,
    metadata: {
      stripe_customer_id: "cus_1",
      subscription_status: "active",
    },
  },
];

const successfulSync: SyncRun = {
  source_key: "ga4",
  status: "success",
  started_at: "2026-04-23T08:00:00.000Z",
  completed_at: "2026-04-23T08:01:00.000Z",
  rows_read: 10,
  rows_written: 10,
  error_message: null,
};

describe("dashboard calculations", () => {
  it("computes core revenue and activation KPIs", () => {
    const data = calculateDashboardData({
      snapshots: [
        snapshot("mrr", 1000),
        snapshot("active_subscriptions", 12),
        snapshot("signup", 100),
        snapshot("activated_workshop", 25),
        snapshot("diagnostic_started", 60),
        snapshot("diagnostic_completed", 48),
      ],
      funnelSnapshots: [],
      syncRuns: [successfulSync],
      workshops,
      subscriptions,
      users,
      now: new Date("2026-04-23T09:00:00.000Z"),
    });

    expect(data.revenue.arr).toBe(12000);
    expect(data.product.activationRate).toBe(25);
    expect(data.executive.some((card) => card.label === "MRR")).toBe(true);
    expect(data.workshopSnapshot.live).toBe(2);
  });

  it("flags stale or missing sources", () => {
    const data = calculateDashboardData({
      snapshots: [],
      funnelSnapshots: [],
      syncRuns: [successfulSync],
      workshops,
      subscriptions,
      users,
      now: new Date("2026-04-23T14:30:00.000Z"),
    });

    expect(data.sources.find((source) => source.sourceKey === "ga4")?.status).toBe(
      "stale",
    );
    expect(
      data.sources.find((source) => source.sourceKey === "stripe")?.status,
    ).toBe("pending");
  });

  it("provides a usable demo dashboard", () => {
    const data = getDemoDashboardData(
      undefined,
      new Date("2026-04-23T09:00:00.000Z"),
    );

    expect(data.setupMode).toBe(true);
    expect(data.executive.length).toBeGreaterThan(0);
    expect(data.funnel.at(-1)?.label).toBe("Paid");
    expect(data.workshopSnapshot.total).toBeGreaterThan(0);
  });

  it("prefers core app diagnostics when warehouse metrics are available", () => {
    const data = calculateDashboardData({
      snapshots: [
        snapshot("core_diagnostics_created", 90),
        snapshot("core_diagnostics_completed", 54),
        snapshot("diagnostic_started", 12),
        snapshot("diagnostic_completed", 6),
      ],
      funnelSnapshots: [],
      syncRuns: [successfulSync],
      workshops,
      subscriptions,
      users,
      now: new Date("2026-04-23T09:00:00.000Z"),
    });

    expect(data.product.diagnosticsStarted).toBe(90);
    expect(data.product.diagnosticsCompleted).toBe(54);
  });
});
