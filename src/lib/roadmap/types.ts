import type { Tables } from "@/lib/database.types";

export type Roadmap = Tables<"roadmaps">;
export type RoadmapGroup = Tables<"roadmap_groups">;
export type RoadmapItem = Tables<"roadmap_items">;

/** A board with its swimlanes and bars nested, as returned by GET /api/roadmap?id=. */
export interface RoadmapBoard extends Roadmap {
  groups: RoadmapGroup[];
  items: RoadmapItem[];
}

/** Zoom levels for the timeline — controls pixels-per-day density. */
export type ZoomLevel = "day" | "week" | "month";

export const PX_PER_DAY: Record<ZoomLevel, number> = {
  day: 34,
  week: 12,
  month: 4,
};

/** Fields shown in the item detail panel that are free-text/enum metadata. */
export const ITEM_STATUSES = ["Not started", "In progress", "Done", "Blocked"] as const;
export const ITEM_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
