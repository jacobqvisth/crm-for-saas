import type { SourceKey } from "@/lib/ceo/sources";
import type {
  DashboardTimeRangeKey,
  DashboardTimeRangeOption,
} from "@/lib/ceo/time-ranges";

export type MetricUnit = "count" | "currency" | "percent" | "seconds";

export type MetricSnapshot = {
  source_key: SourceKey;
  metric_key: string;
  period_start: string;
  period_end: string;
  dimension_key: string;
  dimensions: Record<string, string | number | boolean | null>;
  value: number;
  unit: MetricUnit | string;
  currency: string | null;
  collected_at: string;
};

export type FunnelSnapshot = {
  source_key: SourceKey;
  step_key: string;
  period_start: string;
  period_end: string;
  dimension_key: string;
  dimensions: Record<string, string | number | boolean | null>;
  count: number;
  collected_at: string;
};

export type SyncRun = {
  source_key: SourceKey;
  status: "success" | "failed" | "running" | "skipped";
  started_at: string;
  completed_at: string | null;
  rows_read: number;
  rows_written: number;
  error_message: string | null;
};

export type WarehouseUser = {
  internal_user_id: string;
  workshop_id: string | null;
  customer_io_id: string | null;
  created_at: string | null;
  // Canonical signup timestamp (deriveSignedUpAt chain). Prefer this over
  // created_at for display: created_at is only populated for the ~8% of
  // users whose export row carries user_created_at, while signed_up_at
  // falls back through workshop/Customer.io/Stripe timestamps.
  signed_up_at: string | null;
  last_seen_at: string | null;
  name: string | null;
  phone: string | null;
  core_stripe_customer_id: string | null;
  metadata: Record<string, unknown>;
};

export type WarehouseWorkshop = {
  workshop_id: string;
  name: string | null;
  country: string | null;
  plan_key: string | null;
  created_at: string | null;
  activated_at: string | null;
  language: string | null;
  core_subscription_status: string | null;
  payment_status: string | null;
  trial_end: string | null;
  created_by_agent: boolean | null;
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  is_internal_test: boolean | null;
  churned_at: string | null;
  metadata: Record<string, unknown>;
};

export type WarehouseSubscription = {
  workshop_id: string | null;
  stripe_customer_id: string | null;
  status: string;
  plan_key: string | null;
  mrr_amount_cents: number | null;
  currency: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  metadata: Record<string, unknown>;
};

export type KpiCard = {
  label: string;
  value: string;
  rawValue: number;
  hint: string;
  tone: "revenue" | "growth" | "product" | "warning" | "neutral";
};

export type FunnelStep = {
  key: string;
  label: string;
  value: number;
  conversionFromPrevious: number;
};

export type SourceHealth = {
  sourceKey: SourceKey;
  label: string;
  status: "healthy" | "stale" | "failing" | "pending";
  lastSuccessAt: string | null;
  hoursSinceSuccess: number;
  lastError: string | null;
};

export type RecentSyncRun = {
  sourceKey: SourceKey;
  label: string;
  status: "success" | "failed" | "running" | "skipped";
  startedAt: string;
  completedAt: string | null;
  rowsRead: number;
  rowsWritten: number;
  errorMessage: string | null;
};

export type PerformancePoint = {
  date: string;
  sent: number;
  opened: number;
  clicked: number;
  converted: number;
  bounced: number;
  unsubscribed: number;
};

export type AcquisitionTrendPoint = {
  date: string;
  spend: number;
  clicks: number;
  conversions: number;
};

export type ProductTrendPoint = {
  date: string;
  activeUsers: number;
  newUsers: number;
  diagnosticsStarted: number;
  diagnosticsCompleted: number;
};

export type RevenueTrendPoint = {
  date: string;
  mrr: number;
  activeSubscriptions: number;
  trials: number;
  newPaidWorkshops: number;
  churnedSubscriptions: number;
};

export type OrganicTrendPoint = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type OperationsTrendPoint = {
  date: string;
  diagnosticsCreated: number;
  diagnosticsCompleted: number;
  diagnosticCost: number;
  chatSessions: number;
  chatMessages: number;
  chatCost: number;
};

export type AcquisitionCampaign = {
  campaign: string;
  campaignId: string | null;
  reportingSource: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpc: number;
  ctr: number;
  conversionRate: number;
  shareOfSpend: number;
  shareOfConversions: number;
};

export type LifecycleCampaign = {
  campaign: string;
  campaignId: string | null;
  campaignState: string | null;
  campaignType: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  bounceRate: number;
  unsubscribeRate: number;
};

export type MotorUsageBreakdown = {
  database: string;
  accesses: number;
  uniqueUsers: number;
  uniqueVehicles: number;
};

export type OperationsSummary = {
  totalUsers: number;
  totalWorkshops: number;
  diagnosticsCreated: number;
  diagnosticsCompleted: number;
  completionRate: number;
  diagnosticCost: number;
  costPerDiagnostic: number;
  chatSessions: number;
  chatMessages: number;
  chatCost: number;
  costPerChatSession: number;
  messagesPerChatSession: number;
  motorAccesses: number;
  motorUniqueUsers: number;
  motorUniqueVehicles: number;
  aiTotalCostSnapshot: number;
  aiDiagnosticsCostSnapshot: number;
  aiChatCostSnapshot: number;
  aiChatAdoptionRate: number;
};

export type OrganicBreakdownRow = {
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type WorkshopSnapshot = {
  total: number;
  live: number;
  active: number;
  trialing: number;
  paused: number;
  atRisk: number;
  inactive: number;
  unknown: number;
  stripeLinked: number;
  withCountry: number;
  topCountries: { country: string; workshops: number }[];
  sources: {
    stripe: number;
    customerIo: number;
    unknown: number;
  };
};

export type EnrichmentCoverage = {
  usersWithCustomerIoId: number;
  usersWithCreatedAt: number;
  usersWithSubscriptionStatus: number;
  usersWithStripeCustomerId: number;
  usersWithCoreStripeCustomerId: number;
  usersWithName: number;
  workshopsWithCountry: number;
  workshopsWithSubscriptionStatus: number;
  workshopsWithStripeCustomerId: number;
  workshopsWithLanguage: number;
  workshopsWithCoreStripeCustomerId: number;
  workshopsWithCreatedByAgent: number;
  workshopsWithSubscriptionStatusDrift: number;
};

export type DashboardData = {
  setupMode: boolean;
  generatedAt: string;
  windowLabel: string;
  dateSpan: string;
  selectedRange: DashboardTimeRangeKey;
  timeRangeOptions: DashboardTimeRangeOption[];
  hasLimitedHistory: boolean;
  executive: KpiCard[];
  funnel: FunnelStep[];
  sources: SourceHealth[];
  recentSyncRuns: RecentSyncRun[];
  performance: PerformancePoint[];
  acquisitionTrend: AcquisitionTrendPoint[];
  organicTrend: OrganicTrendPoint[];
  productTrend: ProductTrendPoint[];
  revenueTrend: RevenueTrendPoint[];
  operationsTrend: OperationsTrendPoint[];
  acquisitionCampaigns: AcquisitionCampaign[];
  lifecycleCampaigns: LifecycleCampaign[];
  motorUsage: MotorUsageBreakdown[];
  operations: OperationsSummary;
  workshopSnapshot: WorkshopSnapshot;
  enrichmentCoverage: EnrichmentCoverage;
  marketing: {
    spend: number;
    clicks: number;
    impressions: number;
    conversions: number;
    cpc: number;
    cac: number;
  };
  organic: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    topQueries: OrganicBreakdownRow[];
    topPages: OrganicBreakdownRow[];
    devices: OrganicBreakdownRow[];
    countries: OrganicBreakdownRow[];
  };
  product: {
    activeUsers: number;
    newUsers: number;
    diagnosticsStarted: number;
    diagnosticsCompleted: number;
    activationRate: number;
    platformSplit: { platform: string; users: number }[];
  };
  lifecycle: {
    sent: number;
    delivered: number;
    humanOpened: number;
    clicked: number;
    humanClicked: number;
    converted: number;
    unsubscribed: number;
    bounced: number;
  };
  revenue: RevenueSummary;
  insights: string[];
};

export type RevenuePlanRow = {
  plan: string;
  subscriptions: number;
  mrr: number;
  shareOfMrr: number;
};

export type RevenueChurnPlanRow = {
  plan: string;
  paid: number;
  trialOnly: number;
};

export type RevenueChurnBreakdown = {
  // Window the counts cover (matches the selected dashboard range).
  rangeLabel: string;
  // Canceled in range AND had at least one paid invoice.
  paid: number;
  // Canceled in range with no payment ever (trial-only / lapsed before paying).
  trialOnly: number;
  // True once the Stripe sync has populated ever_paid; until then the split
  // uses a trial-end heuristic and the UI flags it as approximate.
  everPaidKnown: boolean;
  // Account deletions are not yet in the warehouse export.
  deletedTracked: boolean;
  deleted: number;
  byPlan: RevenueChurnPlanRow[];
};

export type RevenueSummary = {
  currency: string;
  // Monthly recurring revenue from currently-active (paying) subscriptions.
  mrr: number;
  arr: number;
  // MRR currently in trial — committed only if those trials convert.
  trialMrr: number;
  activeSubscriptions: number;
  trials: number;
  // Subscriptions paused → effectively back on the Free plan.
  pausedToFree: number;
  newPaidWorkshops: number;
  // Total canceled in range (paid + trialOnly) — kept for back-compat.
  churnedSubscriptions: number;
  planMix: RevenuePlanRow[];
  billing: {
    active: number;
    trialing: number;
    pausedToFree: number;
    canceled: number;
  };
  churn: RevenueChurnBreakdown;
};
