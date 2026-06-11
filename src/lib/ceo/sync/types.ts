import type { SourceKey } from "@/lib/ceo/sources";

export type MetricPoint = {
  sourceKey: SourceKey;
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  value: number;
  unit?: string;
  currency?: string | null;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type FunnelPoint = {
  sourceKey: SourceKey;
  stepKey: string;
  periodStart: Date;
  periodEnd: Date;
  count: number;
  dimensions?: Record<string, string | number | boolean | null>;
};

export type RawMetricRow = {
  sourceKey: SourceKey;
  externalId: string;
  periodStart: Date;
  periodEnd: Date;
  payload: Record<string, unknown>;
};

export type SubscriptionRow = {
  stripe_subscription_id: string;
  workshop_id: string | null;
  stripe_customer_id: string | null;
  status: string;
  plan_key: string | null;
  mrr_amount_cents: number;
  currency: string;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  metadata: Record<string, unknown>;
};

export type UserRow = {
  internal_user_id: string;
  workshop_id: string | null;
  email_hash: string | null;
  customer_io_id: string | null;
  ga_client_id: string | null;
  created_at: string | null;
  signed_up_at: string | null;
  last_seen_at: string | null;
  churned_at: string | null;
  name: string | null;
  phone: string | null;
  core_stripe_customer_id: string | null;
  metadata: Record<string, unknown>;
};

export type UserLoginRow = {
  internal_user_id: string;
  logged_in_at: string;
};

export type FeatureUsageRow = {
  internal_user_id: string;
  feature_key: string;
  granularity: "day" | "month";
  period_start: string;
  usage_count: number;
};

export type WorkshopRow = {
  workshop_id: string;
  name: string | null;
  owner_internal_user_id: string | null;
  country: string | null;
  plan_key: string | null;
  activated_at: string | null;
  churned_at: string | null;
  created_at: string | null;
  language: string | null;
  core_subscription_status: string | null;
  payment_status: string | null;
  trial_end: string | null;
  created_by_agent: boolean | null;
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  metadata: Record<string, unknown>;
};

export type DiagnosticRow = {
  diagnostic_id: string;
  workshop_id: string | null;
  internal_user_id: string | null;
  parent_diagnostic_id: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
  analyzed_at: string | null;
  ai_model: string | null;
  diag_cost: number;
  input_tokens: number;
  output_tokens: number;
  num_causes: number;
  has_chat: boolean;
  has_invoice: boolean;
  metadata: Record<string, unknown>;
};

export type DiagnosticChatRow = {
  chat_id: string;
  diagnostic_id: string | null;
  workshop_id: string | null;
  internal_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number;
  chat_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_thinking_tokens: number;
  metadata: Record<string, unknown>;
};

export type MotorUsageRow = {
  motor_usage_id: string;
  month: string | null;
  database_name: string | null;
  total_accesses: number;
  unique_users: number;
  unique_vehicles: number;
  metadata: Record<string, unknown>;
};

export type CostEntryRow = {
  cost_entry_id: string;
  section: string;
  item_key: string;
  amount: number;
  unit: string;
  snapshot_at: string;
  metadata: Record<string, unknown>;
};

export type SourceSyncWindow = {
  start: Date;
  end: Date;
};

export type SourceSyncResult = {
  sourceKey: SourceKey;
  rowsRead: number;
  metrics: MetricPoint[];
  funnel?: FunnelPoint[];
  rawRows?: RawMetricRow[];
  subscriptions?: SubscriptionRow[];
  users?: UserRow[];
  userLogins?: UserLoginRow[];
  featureUsage?: FeatureUsageRow[];
  workshops?: WorkshopRow[];
  diagnostics?: DiagnosticRow[];
  diagnosticChats?: DiagnosticChatRow[];
  motorUsage?: MotorUsageRow[];
  costEntries?: CostEntryRow[];
  metadata?: Record<string, unknown>;
};

export type SourceConnector = {
  sourceKey: SourceKey;
  fetchMetrics(window: SourceSyncWindow): Promise<SourceSyncResult>;
};

export type SyncRunResult = {
  sourceKey: SourceKey;
  status: "success" | "failed" | "skipped";
  rowsRead: number;
  rowsWritten: number;
  message?: string;
};
