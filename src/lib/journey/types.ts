import type { Database } from "@/lib/database.types";

export type JourneyBoardRow = Database["public"]["Tables"]["journey_boards"]["Row"];
export type JourneyItem = Database["public"]["Tables"]["journey_items"]["Row"];
export type JourneyItemType = "note" | "label" | "image" | "frame";

export interface JourneyBoard extends JourneyBoardRow {
  items: JourneyItem[];
}

/** Sticky-note / frame color tokens → Tailwind classes (Miro-ish palette). */
export const JOURNEY_COLORS: Record<
  string,
  { bg: string; border: string; swatch: string }
> = {
  yellow: { bg: "bg-amber-100", border: "border-amber-200", swatch: "bg-amber-300" },
  green: { bg: "bg-emerald-100", border: "border-emerald-200", swatch: "bg-emerald-300" },
  blue: { bg: "bg-sky-100", border: "border-sky-200", swatch: "bg-sky-300" },
  purple: { bg: "bg-violet-100", border: "border-violet-200", swatch: "bg-violet-300" },
  pink: { bg: "bg-pink-100", border: "border-pink-200", swatch: "bg-pink-300" },
  orange: { bg: "bg-orange-100", border: "border-orange-200", swatch: "bg-orange-300" },
  red: { bg: "bg-rose-100", border: "border-rose-200", swatch: "bg-rose-300" },
  gray: { bg: "bg-slate-100", border: "border-slate-200", swatch: "bg-slate-300" },
};

export const JOURNEY_COLOR_KEYS = Object.keys(JOURNEY_COLORS);

export function journeyColor(key: string | null | undefined) {
  return JOURNEY_COLORS[key ?? "yellow"] ?? JOURNEY_COLORS.yellow;
}

/** Fields the canvas is allowed to update in bulk. */
export interface JourneyItemPatch {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  z?: number;
  content?: string | null;
  color?: string | null;
}
