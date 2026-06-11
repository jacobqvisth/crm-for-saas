import type { Tables } from "@/lib/database.types";

export type ActivationPlan = Tables<"activation_plans">;
export type ActivationGroup = Tables<"activation_plan_groups">;
export type ActivationItem = Tables<"activation_plan_items">;
export type ActivationScenario = Tables<"activation_plan_scenarios">;

/** A plan with its channel swimlanes, touchpoints and scenarios nested, as returned by GET /api/activation?id=. */
export interface ActivationBoard extends ActivationPlan {
  groups: ActivationGroup[];
  items: ActivationItem[];
  scenarios: ActivationScenario[];
}

/** Zoom levels for the timeline — controls pixels-per-day density. */
export type ZoomLevel = "day" | "week" | "month";

export const PX_PER_DAY: Record<ZoomLevel, number> = {
  day: 34,
  week: 12,
  month: 4,
};

export const TRIGGER_TYPES = ["day_offset", "event"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Lifecycle of a touchpoint itself: is it running, planned, or just an idea? */
export const ITEM_STATUSES = ["Live", "Planned", "Idea", "Paused"] as const;

/** Suggested anchor events for event-triggered touchpoints (free text allowed). */
export const ANCHOR_EVENTS = [
  "signup",
  "first_diagnosis",
  "first_completed_diagnostic",
  "trial_end",
  "first_payment",
  "quota_hit",
  "inactive_7d",
] as const;
