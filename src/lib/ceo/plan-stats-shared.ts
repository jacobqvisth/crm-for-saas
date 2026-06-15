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

// Only features we can actually measure are listed — each row carries a stat
// badge (a feature counter, or the seat/user count). Pure entitlement rows
// with no data ("Everything in Small", "Priority support", "Verified
// measurements", "Full Garage history", etc.) are intentionally omitted.
// "OEM technical data" / "Premium data" map to the InfoPro + Motor (Haynes)
// vehicle counters. Paid plans repeat the inherited measurable features
// (diagnostics & chat, AI search) so each plan's own usage is visible rather
// than hidden behind an "Everything in <lower tier>" line.
//
// NOTE: TSB search and Garage history are NOT here — TSB activity exists only
// inside the raw per-diagnostic user_actions.tsbs_tab_viewed arrays (no
// aggregated counter yet) and "search history" views aren't captured in the
// export at all. Add a counter in the core_app sync before listing them.
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: "free",
    name: "Free",
    bullets: [
      { label: "1 diagnostic / day", kind: "metric", features: ["diagnostics"] },
      { label: "1 chat message / day", kind: "metric", features: ["chat"] },
      { label: "10 AI searches / day", kind: "metric", features: ["ai_search"] },
      {
        label: "InfoPro data on 1 demo vehicle",
        kind: "metric",
        features: ["infopro_vehicles"],
      },
    ],
  },
  {
    tier: "one",
    name: "One",
    bullets: [
      {
        label: "Unlimited diagnostics & chat",
        kind: "metric",
        features: ["diagnostics", "chat"],
      },
      { label: "Unlimited AI search", kind: "metric", features: ["ai_search"] },
      {
        label: "OEM technical data",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
    ],
  },
  {
    tier: "small",
    name: "Small",
    bullets: [
      { label: "Multiple users", kind: "seats" },
      {
        label: "Unlimited diagnostics & chat",
        kind: "metric",
        features: ["diagnostics", "chat"],
      },
      { label: "Unlimited AI search", kind: "metric", features: ["ai_search"] },
      {
        label: "Premium data (OEM / InfoPro)",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
    ],
  },
  {
    tier: "large",
    name: "Large",
    bullets: [
      { label: "Multiple users", kind: "seats" },
      {
        label: "Unlimited diagnostics & chat",
        kind: "metric",
        features: ["diagnostics", "chat"],
      },
      { label: "Unlimited AI search", kind: "metric", features: ["ai_search"] },
      {
        label: "Premium data (OEM / InfoPro)",
        kind: "metric",
        features: ["infopro_vehicles", "motor_vehicles"],
      },
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
