// Swimlane / bar color tokens. Stored in the DB as a token string
// (roadmap_groups.color, roadmap_items.color) and resolved to Tailwind
// classes here — never store raw classes in the DB.

export const COLOR_TOKENS = [
  "yellow",
  "green",
  "blue",
  "orange",
  "purple",
  "red",
  "teal",
  "gray",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export interface ColorClasses {
  /** Bar fill + border + text (the timeline bar itself). */
  bar: string;
  /** Small dot / accent used in the left label column and legends. */
  dot: string;
  /** Soft chip background for the swimlane header / phase tag. */
  chip: string;
}

const MAP: Record<ColorToken, ColorClasses> = {
  yellow: {
    bar: "bg-yellow-100 border-yellow-300 text-yellow-900 hover:bg-yellow-200",
    dot: "bg-yellow-400",
    chip: "bg-yellow-100 text-yellow-800",
  },
  green: {
    bar: "bg-green-100 border-green-300 text-green-900 hover:bg-green-200",
    dot: "bg-green-500",
    chip: "bg-green-100 text-green-800",
  },
  blue: {
    bar: "bg-blue-100 border-blue-300 text-blue-900 hover:bg-blue-200",
    dot: "bg-blue-500",
    chip: "bg-blue-100 text-blue-800",
  },
  orange: {
    bar: "bg-orange-100 border-orange-300 text-orange-900 hover:bg-orange-200",
    dot: "bg-orange-500",
    chip: "bg-orange-100 text-orange-800",
  },
  purple: {
    bar: "bg-purple-100 border-purple-300 text-purple-900 hover:bg-purple-200",
    dot: "bg-purple-500",
    chip: "bg-purple-100 text-purple-800",
  },
  red: {
    bar: "bg-red-100 border-red-300 text-red-900 hover:bg-red-200",
    dot: "bg-red-500",
    chip: "bg-red-100 text-red-800",
  },
  teal: {
    bar: "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200",
    dot: "bg-teal-500",
    chip: "bg-teal-100 text-teal-800",
  },
  gray: {
    bar: "bg-slate-100 border-slate-300 text-slate-900 hover:bg-slate-200",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700",
  },
};

export function isColorToken(value: string | null | undefined): value is ColorToken {
  return !!value && (COLOR_TOKENS as readonly string[]).includes(value);
}

export function colorClasses(token: string | null | undefined): ColorClasses {
  return isColorToken(token) ? MAP[token] : MAP.blue;
}

// Visual styling for an item's progress status (used on bars, the detail panel,
// and the AI-suggestions modal). Keyed by the ITEM_STATUSES labels.
export interface StatusStyle {
  dot: string;
  pill: string;
  label: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  "Done": { dot: "bg-green-500", pill: "bg-green-100 text-green-800", label: "Done" },
  "In progress": { dot: "bg-blue-500", pill: "bg-blue-100 text-blue-800", label: "In progress" },
  "Blocked": { dot: "bg-red-500", pill: "bg-red-100 text-red-800", label: "Blocked" },
  "Not started": { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600", label: "Not started" },
};

export function statusStyle(status: string | null | undefined): StatusStyle | null {
  if (!status) return null;
  return STATUS_STYLES[status] ?? { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600", label: status };
}
