// Shared presentational primitives for the Forums → Stats views (Overview,
// Traction, Team, Reach). Kept in one place so every sub-view uses the same
// KPI tile, empty state and bar-chart styling. No data logic here.

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

// Thousands-separated integer for big traction numbers. toLocaleString is safe
// in a server component (no Date/Math.random restriction applies).
export function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function KpiTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-900">
        {typeof value === "number" ? fmt(value) : value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

// Dashed, muted placeholder for a section that has no data yet. The forums
// program is early, so most views lean on this until posting picks up.
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
      {children}
    </p>
  );
}

// Section heading used above tables/charts inside a view.
export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 mt-8 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

// Vertical bar chart (weekly cadence etc.). Each datum: { key, label, value }.
// Optionally a second stacked-alongside series via `value2`/`color2`.
export type VBarDatum = { key: string; label: string; value: number; value2?: number };

export function VBars({
  data,
  color = "bg-orange-400",
  color2 = "bg-sky-400",
  legend,
}: {
  data: VBarDatum[];
  color?: string;
  color2?: string;
  legend?: [string, string];
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.value, d.value2 ?? 0]));
  const hasSecond = data.some((d) => d.value2 != null);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      {hasSecond && legend ? (
        <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${color}`} /> {legend[0]}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${color2}`} /> {legend[1]}
          </span>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5 overflow-x-auto">
        {data.map((d) => (
          <div key={d.key} className="flex min-w-[28px] flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-slate-500">
              {d.value}
              {hasSecond ? ` · ${d.value2 ?? 0}` : ""}
            </span>
            <div className="flex w-full items-end justify-center gap-0.5">
              <div
                className={`w-full rounded-t ${color}`}
                style={{ height: `${Math.max(4, (d.value / max) * 110)}px` }}
                title={`${d.label}: ${d.value}`}
              />
              {hasSecond ? (
                <div
                  className={`w-full rounded-t ${color2}`}
                  style={{ height: `${Math.max(4, ((d.value2 ?? 0) / max) * 110)}px` }}
                  title={`${d.label}: ${d.value2 ?? 0}`}
                />
              ) : null}
            </div>
            <span className="whitespace-nowrap text-[10px] text-slate-400">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One horizontal bar row (leaderboards). Fill width is caller-computed 0–100.
export function HBar({
  rank,
  label,
  fillPct,
  value,
  meta,
  color = "bg-amber-400",
}: {
  rank?: number;
  label: string;
  fillPct: number;
  value: string | number;
  meta?: string;
  color?: string;
}) {
  return (
    <li className="flex items-center gap-3">
      {rank != null ? <span className="w-4 text-right text-xs text-slate-400">{rank}</span> : null}
      <span className="w-32 shrink-0 truncate text-sm text-slate-700" title={label}>
        {label}
      </span>
      <div className="relative h-4 flex-1 rounded bg-slate-100">
        <div className={`h-4 rounded ${color}`} style={{ width: `${Math.max(2, Math.min(100, fillPct))}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-800">{value}</span>
      {meta ? <span className="w-28 text-right text-[11px] text-slate-400">{meta}</span> : null}
    </li>
  );
}
