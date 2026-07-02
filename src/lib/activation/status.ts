// Visual styling for a touchpoint's status (Live / Planned / Idea / Paused).
// Color tokens for swimlanes/bars are shared with the roadmap — see
// src/lib/roadmap/colors.ts.

export interface StatusStyle {
  dot: string;
  pill: string;
  label: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  "Live": { dot: "bg-green-500", pill: "bg-green-100 text-green-800", label: "Live" },
  "Planned": { dot: "bg-blue-500", pill: "bg-blue-100 text-blue-800", label: "Planned" },
  "Idea": { dot: "bg-amber-400", pill: "bg-amber-100 text-amber-800", label: "Idea" },
  "Paused": { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600", label: "Paused" },
};

export function statusStyle(status: string | null | undefined): StatusStyle | null {
  if (!status) return null;
  return STATUS_STYLES[status] ?? { dot: "bg-slate-300", pill: "bg-slate-100 text-slate-600", label: status };
}
