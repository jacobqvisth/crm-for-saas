// Client-safe constants and types for the Feature Usage page. Kept separate
// from src/lib/ceo/data/feature-usage.ts because that loader pulls in the
// server-only Supabase/googleapis graph, which can't be imported from a
// "use client" component.

// Type-only imports are erased at build time, so these don't drag the
// server-only module graphs into client bundles.
import type { AppUsageGranularity } from "@/lib/ceo/data/app-usage";
import type { DashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export const FEATURE_USAGE_FEATURES = [
  {
    key: "diagnostics",
    label: "Diagnostics",
    description: "AI diagnostic sessions started",
  },
  {
    key: "chat",
    label: "Chat",
    description: "Follow-up chat sessions on a diagnostic",
  },
  {
    key: "ai_search",
    label: "AI Search",
    description: "AI search queries",
  },
  {
    key: "vrm_lookups",
    label: "VRM Lookups",
    description: "Vehicle registration (license plate) lookups",
  },
  {
    key: "infopro_vehicles",
    label: "InfoPro Vehicles",
    description: "Vehicles opened in the InfoPro database",
  },
  {
    key: "motor_vehicles",
    label: "Motor Vehicles",
    description: "Vehicles opened in the Motor database",
  },
] as const;

export type FeatureUsageFeatureKey =
  (typeof FEATURE_USAGE_FEATURES)[number]["key"];

export const FEATURE_USAGE_FEATURE_KEYS = FEATURE_USAGE_FEATURES.map(
  (feature) => feature.key,
);

export type FeatureTotals = Record<FeatureUsageFeatureKey, number>;

export type FeatureUsageBucketRow = {
  bucket: string;
  bucketLabel: string;
  bucketShortLabel: string;
  logins: number;
  loginUsers: number;
  features: FeatureTotals;
  featureTotal: number;
};

export type FeatureUsageFeatureSummary = {
  key: FeatureUsageFeatureKey;
  label: string;
  description: string;
  total: number;
  users: number;
  lastActiveDate: string | null;
};

export type FeatureUsageUserRow = {
  internalUserId: string;
  username: string | null;
  name: string | null;
  company: string | null;
  role: string | null;
  // wl workshop UUID, for linking to /dashboard/workshops.
  workshopId: string | null;
  logins: number;
  lastLoginAt: string | null;
  features: FeatureTotals;
  featureTotal: number;
};

export type FeatureUsageMonthlyRow = {
  month: string;
  feature: FeatureUsageFeatureKey;
  label: string;
  total: number;
  users: number;
};

export type FeatureUsageData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  rangeSpan: string;
  granularity: AppUsageGranularity;
  note: string;
  totals: {
    loginUsers: number;
    logins: number;
    featureUsers: number;
    featureEvents: number;
  };
  features: FeatureUsageFeatureSummary[];
  buckets: FeatureUsageBucketRow[];
  users: FeatureUsageUserRow[];
  monthly: FeatureUsageMonthlyRow[];
};
