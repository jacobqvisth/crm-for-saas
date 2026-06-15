// Client-safe constants and types for the Plan Stats page
// (/dashboard/plan-stats). Kept separate from the server-only loader
// (src/lib/ceo/data/plan-stats.ts) so the "use client" content component can
// import the plan/bullet config and types without dragging in the Supabase /
// googleapis server graph.

import type { FeatureUsageFeatureKey } from "@/lib/ceo/feature-usage-shared";
import type { DashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

// The four canonical pricing tiers, in the order shown on wrenchlane.com/pricing.
export const PLAN_TIERS = ["free", "one", "small", "large"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

// Maps a stored dashboard_workshops.plan_key (e.g. "small_monthly",
// "large_yearly", "free", "one_monthly") onto a canonical tier. Returns null
// for unrecognised / unset keys so callers can choose to drop them.
export function planTierFromKey(planKey: string | null | undefined): PlanTier | null {
  if (!planKey) return null;
  const head = planKey.trim().toLowerCase().split("_")[0];
  return (PLAN_TIERS as readonly string[]).includes(head)
    ? (head as PlanTier)
    : null;
}

// A single feature row shown on a pricing card. Each row mirrors a verbatim
// bullet from the live pricing page, tagged with what (if anything) we can
// measure for it:
//   - "metric": badge shows summed events across `features` for this plan
//   - "seats":  badge shows the number of users on this plan
//   - "plain":  a normal entitlement checkmark, nothing to measure
//   - "locked": shown greyed out (the free plan's not-included rows)
export type PlanBulletKind = "metric" | "seats" | "plain" | "locked";

export type PlanBullet = {
  label: string;
  kind: PlanBulletKind;
  // Which feature counters back a "metric" bullet (summed for the badge).
  features?: FeatureUsageFeatureKey[];
};

export type PlanDefinition = {
  tier: PlanTier;
  name: string;
  bullets: PlanBullet[];
};

// Baseline features included on every plan. The free plan lists these, and
// since paid plans include everything Free has, they're prepended to the top
// of each paid plan too. Only the genuine always-on capabilities live here —
// free-tier *limitations* like "1 diagnostic / day" or "Last 5 ongoing
// diagnostics" are intentionally excluded because paid plans supersede them.
const BASELINE_BULLETS: PlanBullet[] = [
  { label: "TSB search", kind: "plain" },
  { label: "Diagnostic reports", kind: "plain" },
];

// Bullets transcribed verbatim from the live pricing page (the granular
// per-plan list), each tagged with the feature counter(s) that back it.
// OEM/Premium data rows map to the InfoPro + Motor vehicle counters; to avoid
// showing the same number twice on a card, only the most representative row
// per card carries the metric and the rest stay as plain entitlements.
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: "free",
    name: "Free",
    bullets: [
      { label: "1 diagnostic / day", kind: "metric", features: ["diagnostics"] },
      { label: "1 chat message / day", kind: "metric", features: ["chat"] },
      { label: "TSB search", kind: "plain" },
      { label: "Diagnostic reports", kind: "plain" },
      { label: "Last 5 ongoing diagnostics", kind: "plain" },
      { label: "10 AI searches / day", kind: "metric", features: ["ai_search"] },
      {
        label: "InfoPro data on 1 demo vehicle",
        kind: "metric",
        features: ["infopro_vehicles"],
      },
      { label: "Full InfoPro on all vehicles", kind: "locked" },
      { label: "Verified measurements", kind: "locked" },
      { label: "Team members", kind: "locked" },
    ],
  },
  {
    tier: "one",
    name: "One",
    bullets: [
      ...BASELINE_BULLETS,
      { label: "1 fully unlocked vehicle", kind: "plain" },
      {
        label: "Unlimited diagnostics & chat",
        kind: "metric",
        features: ["diagnostics", "chat"],
      },
      { label: "Full Garage history", kind: "plain" },
      {
        label: "OEM technical data (1 vehicle)",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
      { label: "Unlimited AI search", kind: "metric", features: ["ai_search"] },
      { label: "Verified measurements (1 vehicle)", kind: "plain" },
    ],
  },
  {
    tier: "small",
    name: "Small",
    bullets: [
      ...BASELINE_BULLETS,
      { label: "Multiple users", kind: "seats" },
      {
        label: "Premium data for 20 vehicles / month",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
      { label: "Everything in One", kind: "plain" },
      { label: "Verified measurements", kind: "plain" },
      { label: "OEM technical data", kind: "plain" },
      { label: "Unlimited AI search", kind: "metric", features: ["ai_search"] },
      { label: "Priority support", kind: "plain" },
    ],
  },
  {
    tier: "large",
    name: "Large",
    bullets: [
      ...BASELINE_BULLETS,
      { label: "Multiple users", kind: "seats" },
      {
        label: "Premium data for 80 vehicles / month",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
      { label: "Everything in Small", kind: "plain" },
      { label: "Priority support", kind: "plain" },
    ],
  },
];

// Per-feature numbers for a single plan (used by both the card badges and the
// expandable drill-down table).
export type PlanFeatureStat = {
  key: FeatureUsageFeatureKey;
  label: string;
  description: string;
  events: number;
  users: number;
  // events / users on this plan (0 when no users used the feature).
  avgPerUser: number;
};

export type PlanStatRow = {
  tier: PlanTier;
  // Distinct app users mapped to this plan (whole user base, not just active).
  users: number;
  // Distinct workshops on this plan.
  workshops: number;
  // Distinct users active in the range (behaviour-based: GA4 engagement OR a
  // diagnostic OR a tracked feature event — not logins).
  activeUsers: number;
  // Total feature events across all six counters in the range.
  featureEvents: number;
  features: PlanFeatureStat[];
};

export type PlanStatsData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  rangeSpan: string;
  note: string;
  totals: {
    users: number;
    activeUsers: number;
    featureEvents: number;
  };
  // Keyed by tier; always contains all four tiers (zero-filled if empty).
  plans: PlanStatRow[];
};
