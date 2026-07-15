import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { ForumsTabs } from "./forums-tabs";

// The Stats tab is split into sub-views selected by ?view=. Overview is the
// default (no param); Traction / Team / Reach add depth. The Forums tab bar
// still shows "Stats" as active — this is a second-level nav under it.
export type StatsView = "overview" | "traction" | "team" | "reach";

const VIEWS: { key: StatsView; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "traction", label: "Traction" },
  { key: "team", label: "Team" },
  { key: "reach", label: "Reach" },
];

export function normalizeStatsView(raw: string | undefined): StatsView {
  return VIEWS.some((v) => v.key === raw) ? (raw as StatsView) : "overview";
}

function StatsNav({ view }: { view: StatsView }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      {VIEWS.map((v) => {
        const href = v.key === "overview" ? "/forums/stats" : `/forums/stats?view=${v.key}`;
        const active = v.key === view;
        return (
          <Link
            key={v.key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700"
                : "rounded-full px-3 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            }
          >
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}

export function StatsShell({
  view,
  subtitle,
  children,
}: {
  view: StatsView;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Stats</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>

      <ForumsTabs active="stats" />
      <StatsNav view={view} />

      {children}
    </div>
  );
}
