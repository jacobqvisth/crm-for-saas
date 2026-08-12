"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
  HelpCircle,
  RotateCcw,
  TrendingDown,
  X,
} from "lucide-react";
import {
  ASSUMPTION_BOUNDS,
  CAC_LTV_RANGE_PRESETS,
  CAC_LTV_TIERS,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_GROWTH,
  DEFAULT_RANGE_PRESET_KEY,
  GROWTH_BOUNDS,
  LIST_PRICES_SEK,
  MIN_VEHICLE_SAMPLE,
  PRICE_BOUNDS,
  SENSITIVITY_CAC_SEK,
  SENSITIVITY_CHURN_PCT,
  SENSITIVITY_CONVERSION_PCT,
  TARGET_LTV_CAC,
  affordableCostPerSignup,
  blendTiers,
  breakEvenMonths,
  cacPerCustomer,
  computeTierEconomics,
  cumulativeGrossProfit,
  maxSurvivableChurnPct,
  requiredConversionPct,
  requiredPriceForTarget,
  simulateGrowth,
  type CacLtvAssumptions,
  type CacLtvData,
  type CacLtvTierKey,
  type GrowthInputs,
  type GrowthMonthRow,
  type GrowthResult,
  type TierEconomics,
} from "@/lib/ceo/cac-ltv-shared";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function sek(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "∞";
  return `${new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)} kr`;
}

function num(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "∞";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function pct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function months(value: number | null): string {
  if (value === null) return "Never";
  if (!Number.isFinite(value)) return "Never";
  return `${value.toFixed(1)} mo`;
}

// ---------------------------------------------------------------------------
// Payback thresholds.
//
// A status scale, not a sequential ramp: payback has a conventional good
// direction and well-known break points (under 12 months is the SMB SaaS bar).
// Every cell prints its own number, so color is secondary encoding only.
// ---------------------------------------------------------------------------

// Matches SELF_SERVE_COHORT_START in the loader. Kept as a label rather than
// imported because the loader is server-only.
const SELF_SERVE_START_LABEL = "May 2026";

function paybackBand(value: number | null): {
  cell: string;
  text: string;
  label: string;
} {
  if (value === null || !Number.isFinite(value)) {
    return { cell: "bg-rose-600", text: "text-white", label: "never pays back" };
  }
  if (value <= 6) return { cell: "bg-emerald-100", text: "text-emerald-900", label: "fast" };
  if (value <= 12) return { cell: "bg-sky-100", text: "text-sky-900", label: "healthy" };
  if (value <= 24) return { cell: "bg-amber-100", text: "text-amber-900", label: "slow" };
  return { cell: "bg-rose-100", text: "text-rose-900", label: "too slow" };
}

function ltvCacBand(value: number): { cell: string; text: string } {
  if (!Number.isFinite(value) || value <= 0)
    return { cell: "bg-rose-600", text: "text-white" };
  if (value >= 3) return { cell: "bg-emerald-100", text: "text-emerald-900" };
  if (value >= 2) return { cell: "bg-sky-100", text: "text-sky-900" };
  if (value >= 1) return { cell: "bg-amber-100", text: "text-amber-900" };
  return { cell: "bg-rose-100", text: "text-rose-900" };
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Panel({
  title,
  eyebrow,
  description,
  children,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  now,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  /** The value at today's actuals. Shown only when it differs from `value`. */
  now?: string;
}) {
  const toneClass = {
    neutral: "text-slate-900",
    good: "text-emerald-700",
    bad: "text-rose-700",
    warn: "text-amber-700",
  }[tone];
  const showNow = now !== undefined && now !== value;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-600">{label}</div>
      {showNow ? (
        <div className="mt-1 text-[11px] font-medium tabular-nums text-indigo-700">
          Now: {now}
        </div>
      ) : null}
      {hint ? <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div> : null}
    </div>
  );
}

type SliderBounds = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly label: string;
  readonly unit: string;
};

// Takes either an assumption `field` (bounds looked up from ASSUMPTION_BOUNDS,
// id derived so it stays stable for tests) or an explicit bounds + id, which is
// what the growth controls use.
function Slider({
  field,
  bounds: boundsProp,
  id: idProp,
  value,
  onChange,
  seeded,
  baseline,
  baselineLabel,
}: {
  // tierPricesSek is a per-tier record, not a scalar, so it has its own
  // controls and is excluded here.
  field?: Exclude<keyof CacLtvAssumptions, "tierPricesSek">;
  bounds?: SliderBounds;
  id?: string;
  value: number;
  onChange: (next: number) => void;
  seeded?: string;
  /** The current/actual value. Drawn as a tick and named under the control. */
  baseline?: number;
  /** Overrides the "(actual)" suffix, e.g. when the value could not be measured. */
  baselineLabel?: string;
}) {
  const bounds = boundsProp ?? (field ? ASSUMPTION_BOUNDS[field] : undefined);
  const id = idProp ?? (field ? `slider-${field}` : undefined);
  if (!bounds || !id) return null;

  const fmt = (v: number) =>
    bounds.unit === "%"
      ? `${v}%`
      : bounds.unit === "months"
        ? `${v} mo`
        : `${new Intl.NumberFormat("sv-SE").format(v)} ${bounds.unit}`;

  // Where the current/actual value sits on the track, so "what is now" is
  // visible at a glance and it is obvious when a slider has been moved off it.
  const hasBaseline = baseline !== undefined && Number.isFinite(baseline);
  const span = bounds.max - bounds.min;
  const baselinePct =
    hasBaseline && span > 0
      ? Math.max(0, Math.min(100, ((baseline! - bounds.min) / span) * 100))
      : null;
  const movedOff = hasBaseline && Math.abs(value - baseline!) > bounds.step / 2;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-medium text-slate-700" htmlFor={id}>
          {bounds.label}
        </label>
        <span
          className={`text-sm font-semibold tabular-nums ${
            movedOff ? "text-indigo-700" : "text-slate-900"
          }`}
        >
          {fmt(value)}
        </span>
      </div>

      <div className="relative mt-1.5">
        <input
          className="w-full accent-indigo-600"
          id={id}
          max={bounds.max}
          min={bounds.min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={bounds.step}
          type="range"
          value={value}
        />
        {/* Tick at the current/actual value. */}
        {baselinePct !== null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-0.5 h-2 w-0.5 rounded-full bg-slate-800/70"
            style={{ left: `calc(${baselinePct}% )` }}
            title={`Now: ${fmt(baseline!)}`}
          />
        ) : null}
      </div>

      {hasBaseline ? (
        <p className="mt-1 text-[11px] font-medium tabular-nums">
          {movedOff ? (
            <span className="text-indigo-700">
              Now {fmt(baseline!)} → modelling {fmt(value)}
            </span>
          ) : (
            <span className={baselineLabel ? "text-rose-700" : "text-slate-500"}>
              Now: {fmt(baseline!)} ({baselineLabel ?? "actual"})
            </span>
          )}
        </p>
      ) : null}

      {seeded ? (
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{seeded}</p>
      ) : null}
    </div>
  );
}

function AttributionPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
    measured: {
      cls: "bg-emerald-100 text-emerald-800",
      label: "Measured",
      icon: <Check className="h-3 w-3" />,
    },
    "spend-only": {
      cls: "bg-amber-100 text-amber-800",
      label: "Spend only",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    "volume-only": {
      cls: "bg-amber-100 text-amber-800",
      label: "Volume only",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    none: {
      cls: "bg-rose-100 text-rose-800",
      label: "Not attributed",
      icon: <X className="h-3 w-3" />,
    },
  };
  const entry = map[status] ?? map.none;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${entry.cls}`}
    >
      {entry.icon}
      {entry.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Break-even curve.
//
// One measure on one axis: cumulative survival-weighted gross profit per
// acquired customer, in SEK, month by month. The CAC is drawn as a horizontal
// threshold, and the LTV ceiling as a dotted asymptote — the two lines the
// curve has to clear and can never clear, respectively.
// ---------------------------------------------------------------------------

const CURVE_MONTHS = 36;

function BreakEvenCurve({
  grossProfitSek,
  churnPct,
  cacSek,
  breakEven,
}: {
  grossProfitSek: number;
  churnPct: number;
  cacSek: number;
  breakEven: number | null;
}) {
  const points = useMemo(
    () =>
      Array.from({ length: CURVE_MONTHS + 1 }, (_, month) => ({
        month,
        value: cumulativeGrossProfit(grossProfitSek, churnPct, month),
      })),
    [grossProfitSek, churnPct],
  );

  const ltv = churnPct > 0 ? grossProfitSek / (churnPct / 100) : Number.POSITIVE_INFINITY;
  const maxValue = Math.max(
    points[points.length - 1].value,
    Number.isFinite(cacSek) ? cacSek * 1.15 : 0,
    1,
  );

  const width = 720;
  const height = 240;
  const padLeft = 64;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (month: number) => padLeft + (month / CURVE_MONTHS) * plotW;
  const y = (value: number) => padTop + plotH - (value / maxValue) * plotH;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.month).toFixed(1)} ${y(point.value).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${x(CURVE_MONTHS).toFixed(1)} ${y(0).toFixed(1)} L ${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * maxValue);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[#465fff]" />
          Cumulative gross profit per customer
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-rose-500" />
          CAC per paying customer ({sek(cacSek)})
        </span>
        {Number.isFinite(ltv) ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-0 w-4 border-t-2 border-dotted border-slate-400"
              style={{ height: 0 }}
            />
            LTV ceiling ({sek(ltv)})
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <svg
          className="min-w-[560px]"
          height={height}
          role="img"
          aria-label={`Cumulative gross profit per acquired customer over ${CURVE_MONTHS} months against a CAC of ${sek(cacSek)}`}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          <defs>
            <linearGradient id="cacltv-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#465fff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#465fff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridValues.map((value) => (
            <g key={value}>
              <line
                stroke="#e2e8f0"
                strokeWidth="1"
                x1={padLeft}
                x2={width - padRight}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                className="fill-slate-400 text-[10px] tabular-nums"
                textAnchor="end"
                x={padLeft - 8}
                y={y(value) + 3}
              >
                {num(value)}
              </text>
            </g>
          ))}

          {/* LTV asymptote: the ceiling the curve converges on and never passes. */}
          {Number.isFinite(ltv) && ltv <= maxValue ? (
            <line
              stroke="#94a3b8"
              strokeDasharray="2 3"
              strokeWidth="1.5"
              x1={padLeft}
              x2={width - padRight}
              y1={y(ltv)}
              y2={y(ltv)}
            />
          ) : null}

          <path d={areaPath} fill="url(#cacltv-fill)" />
          <path d={linePath} fill="none" stroke="#465fff" strokeWidth="2" />

          {/* CAC threshold. */}
          {Number.isFinite(cacSek) && cacSek <= maxValue ? (
            <line
              stroke="#f43f5e"
              strokeWidth="2"
              x1={padLeft}
              x2={width - padRight}
              y1={y(cacSek)}
              y2={y(cacSek)}
            />
          ) : null}

          {/* Break-even marker, directly labeled. */}
          {breakEven !== null && breakEven <= CURVE_MONTHS ? (
            <g>
              <line
                stroke="#0f172a"
                strokeDasharray="3 3"
                strokeWidth="1"
                x1={x(breakEven)}
                x2={x(breakEven)}
                y1={y(cacSek)}
                y2={padTop + plotH}
              />
              <circle
                cx={x(breakEven)}
                cy={y(cacSek)}
                fill="#ffffff"
                r="5"
                stroke="#0f172a"
                strokeWidth="2"
              />
              <text
                className="fill-slate-900 text-[11px] font-semibold"
                textAnchor={breakEven > CURVE_MONTHS * 0.75 ? "end" : "start"}
                x={x(breakEven) + (breakEven > CURVE_MONTHS * 0.75 ? -8 : 8)}
                y={y(cacSek) - 10}
              >
                Break-even {breakEven.toFixed(1)} mo
              </text>
            </g>
          ) : null}

          {[0, 6, 12, 18, 24, 30, 36].map((month) => (
            <text
              className="fill-slate-400 text-[10px] tabular-nums"
              key={month}
              textAnchor="middle"
              x={x(month)}
              y={height - 8}
            >
              {month}
            </text>
          ))}
          <text
            className="fill-slate-400 text-[10px]"
            textAnchor="middle"
            x={padLeft + plotW / 2}
            y={height - 8 - 14}
            style={{ display: "none" }}
          >
            months
          </text>
        </svg>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Months since acquisition. Gross profit in SEK per acquired customer, each
        month weighted by the chance the customer is still subscribed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Growth simulator charts.
//
// Two separate charts on purpose. Payers and SEK are different units, and a
// dual-axis chart would invite reading a crossing point that means nothing.
// ---------------------------------------------------------------------------

function PayerGrowthChart({ result }: { result: GrowthResult }) {
  const rows = result.rows;
  const width = 720;
  const height = 200;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const ceiling = Number.isFinite(result.steadyStatePayers) ? result.steadyStatePayers : 0;
  const maxValue = Math.max(ceiling * 1.08, ...rows.map((r) => r.payerBase), 1);
  const x = (month: number) =>
    padLeft + ((month - 1) / Math.max(1, rows.length - 1)) * plotW;
  const y = (value: number) => padTop + plotH - (value / maxValue) * plotH;

  const line = rows
    .map((r, i) => `${i === 0 ? "M" : "L"} ${x(r.month).toFixed(1)} ${y(r.payerBase).toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${x(rows[rows.length - 1]?.month ?? 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(1).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => r * maxValue);
  const monthTicks = rows
    .map((r) => r.month)
    .filter((m) => m === 1 || m % Math.max(1, Math.round(rows.length / 6)) === 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[#12b76a]" />
          Paying customers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
          Steady-state ceiling ({num(ceiling)} payers)
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          className="min-w-[560px]"
          height={height}
          role="img"
          aria-label={`Paying customers over ${rows.length} months, converging on ${num(ceiling)}`}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          <defs>
            <linearGradient id="growth-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#12b76a" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#12b76a" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line stroke="#e2e8f0" x1={padLeft} x2={width - padRight} y1={y(t)} y2={y(t)} />
              <text
                className="fill-slate-400 text-[10px] tabular-nums"
                textAnchor="end"
                x={padLeft - 8}
                y={y(t) + 3}
              >
                {num(t)}
              </text>
            </g>
          ))}
          {ceiling > 0 && ceiling <= maxValue ? (
            <line
              stroke="#94a3b8"
              strokeDasharray="4 3"
              strokeWidth="1.5"
              x1={padLeft}
              x2={width - padRight}
              y1={y(ceiling)}
              y2={y(ceiling)}
            />
          ) : null}
          <path d={area} fill="url(#growth-fill)" />
          <path d={line} fill="none" stroke="#12b76a" strokeWidth="2" />
          {monthTicks.map((m) => (
            <text
              className="fill-slate-400 text-[10px] tabular-nums"
              key={m}
              textAnchor="middle"
              x={x(m)}
              y={height - 8}
            >
              {m}
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Months of constant spend. The curve flattens onto the ceiling because
        churn removes a fixed share of the base every month — past that point more
        months buy nothing, only more budget, better conversion or lower churn do.
      </p>
    </div>
  );
}

function CashChart({ result }: { result: GrowthResult }) {
  const rows = result.rows;
  const width = 720;
  const height = 200;
  const padLeft = 64;
  const padRight = 16;
  const padTop = 12;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const values = rows.flatMap((r) => [r.cumulativeSpendSek, r.cumulativeSpendSek + r.cumulativeNetSek]);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(0, ...rows.map((r) => r.cumulativeNetSek));
  const span = maxValue - minValue || 1;

  const x = (month: number) => padLeft + ((month - 1) / Math.max(1, rows.length - 1)) * plotW;
  const y = (value: number) => padTop + plotH - ((value - minValue) / span) * plotH;

  const path = (pick: (r: GrowthMonthRow) => number) =>
    rows.map((r, i) => `${i === 0 ? "M" : "L"} ${x(r.month).toFixed(1)} ${y(pick(r)).toFixed(1)}`).join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => minValue + r * span);
  const monthTicks = rows
    .map((r) => r.month)
    .filter((m) => m === 1 || m % Math.max(1, Math.round(rows.length / 6)) === 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-rose-500" />
          Cumulative spend
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-[#465fff]" />
          Cumulative gross profit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-2 border-dotted border-slate-500" />
          Net (profit − spend)
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          className="min-w-[560px]"
          height={height}
          role="img"
          aria-label="Cumulative spend against cumulative gross profit in SEK"
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line stroke="#e2e8f0" x1={padLeft} x2={width - padRight} y1={y(t)} y2={y(t)} />
              <text
                className="fill-slate-400 text-[10px] tabular-nums"
                textAnchor="end"
                x={padLeft - 8}
                y={y(t) + 3}
              >
                {compactSek(t)}
              </text>
            </g>
          ))}
          {/* Zero line — the net series crossing it is payback. */}
          {minValue < 0 ? (
            <line stroke="#94a3b8" strokeWidth="1" x1={padLeft} x2={width - padRight} y1={y(0)} y2={y(0)} />
          ) : null}
          <path d={path((r) => r.cumulativeSpendSek)} fill="none" stroke="#f43f5e" strokeWidth="2" />
          <path
            d={path((r) => r.cumulativeSpendSek + r.cumulativeNetSek)}
            fill="none"
            stroke="#465fff"
            strokeWidth="2"
          />
          <path
            d={path((r) => r.cumulativeNetSek)}
            fill="none"
            stroke="#475569"
            strokeDasharray="3 3"
            strokeWidth="1.5"
          />
          {result.paybackMonth !== null ? (
            <g>
              <circle
                cx={x(result.paybackMonth)}
                cy={y(0)}
                fill="#ffffff"
                r="5"
                stroke="#0f172a"
                strokeWidth="2"
              />
              <text
                className="fill-slate-900 text-[11px] font-semibold"
                textAnchor={result.paybackMonth > rows.length * 0.7 ? "end" : "start"}
                x={x(result.paybackMonth) + (result.paybackMonth > rows.length * 0.7 ? -8 : 8)}
                y={y(0) - 8}
              >
                Cash-positive month {result.paybackMonth}
              </text>
            </g>
          ) : null}
          {monthTicks.map((m) => (
            <text
              className="fill-slate-400 text-[10px] tabular-nums"
              key={m}
              textAnchor="middle"
              x={x(m)}
              y={height - 8}
            >
              {m}
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Cumulative SEK. The dotted net line crossing zero is the month the
        programme has returned more gross profit than it has spent. Spend keeps
        accruing forever, so if the net line turns down again the programme is
        running past the point the funnel can support.
      </p>
    </div>
  );
}

function compactSek(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return num(value);
}

function GrowthSection({
  data,
  assumptions,
  aiCostPerMonthSek,
}: {
  data: CacLtvData;
  assumptions: CacLtvAssumptions;
  aiCostPerMonthSek: number;
}) {
  // Seed the new-customer mix from the trials in flight, not the paying base.
  // The paying base carries Large accounts that ads did not produce, and using
  // it would flatter the projection — the trial pipeline is what spend is
  // actually converting into right now.
  const seededMix = useMemo(() => {
    const mix = data.selfServeMixByTier;
    const total = CAC_LTV_TIERS.reduce((sum, tier) => sum + mix[tier.key], 0);
    if (total <= 0) return DEFAULT_GROWTH.newCustomerMix;
    return {
      one: Math.round((mix.one / total) * 100),
      small: Math.round((mix.small / total) * 100),
      large: Math.round((mix.large / total) * 100),
    };
  }, [data.selfServeMixByTier]);

  const [growth, setGrowth] = useState<GrowthInputs>({
    ...DEFAULT_GROWTH,
    newCustomerMix: seededMix,
  });

  const result = useMemo(
    () =>
      simulateGrowth(growth, assumptions, data.vehiclesPerMonthByTier, aiCostPerMonthSek),
    [growth, assumptions, data.vehiclesPerMonthByTier, aiCostPerMonthSek],
  );

  const setField = (field: "monthlyBudgetSek" | "horizonMonths" | "conversionLagMonths") =>
    (next: number) => setGrowth((cur) => ({ ...cur, [field]: next }));

  const setMix = (tier: CacLtvTierKey) => (next: number) =>
    setGrowth((cur) => ({
      ...cur,
      newCustomerMix: { ...cur.newCustomerMix, [tier]: next },
    }));

  const mixTotal = CAC_LTV_TIERS.reduce((sum, t) => sum + growth.newCustomerMix[t.key], 0);
  const annualSpend = growth.monthlyBudgetSek * 12;

  // Table is sampled so a 48-month horizon stays readable.
  const step = Math.max(1, Math.round(result.rows.length / 12));
  const tableRows = result.rows.filter(
    (r) => r.month === 1 || r.month % step === 0 || r.month === result.rows.length,
  );

  return (
    <Panel
      actions={
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => setGrowth({ ...DEFAULT_GROWTH, newCustomerMix: seededMix })}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      }
      description="Constant monthly spend projected forward. A signup is only a signup — this section keeps the dilution visible at every step, because the gap between what spend buys in signups and what it buys in revenue is the entire question."
      eyebrow="Spend → growth"
      title="What a monthly budget actually buys"
    >
      {/* Controls */}
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
        <Slider
          bounds={GROWTH_BOUNDS.monthlyBudgetSek}
          id="growth-budget"
          onChange={setField("monthlyBudgetSek")}
          seeded={`${sek(annualSpend)} a year. Actual spend has run ${sek(data.months.filter((m) => m.adSpendUsd > 0).slice(-1)[0]?.adSpendUsd * assumptions.sekPerUsd || 0)} in the latest month with spend.`}
          value={growth.monthlyBudgetSek}
        />
        <Slider
          bounds={GROWTH_BOUNDS.horizonMonths}
          id="growth-horizon"
          onChange={setField("horizonMonths")}
          seeded="How far to project. Watch the payer curve flatten."
          value={growth.horizonMonths}
        />
        <Slider
          bounds={GROWTH_BOUNDS.conversionLagMonths}
          id="growth-lag"
          onChange={setField("conversionLagMonths")}
          seeded="14-day trial plus the first invoice, so roughly one month."
          value={growth.conversionLagMonths}
        />
      </div>

      {/* The dilution chain, stated plainly */}
      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-xs font-semibold text-slate-700">
          What {sek(growth.monthlyBudgetSek)} a month buys, step by step
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3">
          <FunnelStep
            label="Spend"
            sub="per month"
            value={sek(growth.monthlyBudgetSek)}
          />
          <StepArrow note={`÷ ${sek(assumptions.cacPerSignupSek)}`} />
          <FunnelStep
            label="Signups"
            sub="per month"
            value={num(result.signupsPerMonth)}
          />
          <StepArrow note={`× ${pct(assumptions.signupToPaidPct)}`} />
          <FunnelStep
            label="New payers"
            sub="per month"
            tone="good"
            value={result.newPayersPerMonth.toFixed(1)}
          />
          <StepArrow note={`÷ ${pct(assumptions.monthlyChurnPct)} churn`} />
          <FunnelStep
            label="Payer ceiling"
            sub="steady state"
            tone="good"
            value={num(result.steadyStatePayers)}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          The other{" "}
          <strong className="tabular-nums">
            {num(result.signupsPerMonth - result.newPayersPerMonth)}
          </strong>{" "}
          signups a month ({pct(100 - assumptions.signupToPaidPct)} of them) never
          pay and stay on Free. Over {growth.horizonMonths} months that is{" "}
          <strong className="tabular-nums">{num(result.endFreeBase)}</strong>{" "}
          free accounts added. They are counted here but not costed.
        </p>
      </div>

      {/* Headline outcomes */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          hint={`${num(result.steadyStatePayers)} payer ceiling × ${sek(result.newMixArpaSek)} ARPA`}
          label="Steady-state MRR"
          tone="good"
          value={sek(result.steadyStateMrrSek)}
        />
        <Stat
          hint={`${num(result.endPayers)} payers alive at month ${growth.horizonMonths}`}
          label={`MRR at month ${growth.horizonMonths}`}
          value={sek(result.endMrrSek)}
        />
        <Stat
          hint={`${sek(result.totalSpendSek)} spent over the horizon`}
          label="Cost per retained payer"
          value={
            Number.isFinite(result.costPerRetainedPayerSek)
              ? sek(result.costPerRetainedPayerSek)
              : "—"
          }
        />
        <Stat
          hint={
            result.paybackMonth !== null
              ? "Cumulative gross profit passes cumulative spend"
              : "Gross profit never catches spend at these settings"
          }
          label="Programme turns cash-positive"
          tone={result.paybackMonth !== null ? "good" : "bad"}
          value={result.paybackMonth !== null ? `Month ${result.paybackMonth}` : "Never"}
        />
      </div>

      {/* New-customer mix */}
      <div className="mt-5 rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">
            Plan mix of new customers
          </p>
          <p className="text-[11px] text-slate-500">
            Blended ARPA{" "}
            <strong className="tabular-nums text-slate-700">{sek(result.newMixArpaSek)}</strong>{" "}
            · gross profit{" "}
            <strong className="tabular-nums text-slate-700">
              {sek(result.newMixGrossProfitSek)}
            </strong>
            /mo
            {mixTotal !== 100 ? (
              <span className="ml-1 text-amber-700">(shares total {mixTotal}%, normalised)</span>
            ) : null}
          </p>
        </div>
        <div className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {CAC_LTV_TIERS.map((tier) => (
            <div key={tier.key}>
              <div className="flex items-baseline justify-between gap-2">
                <label className="text-xs font-medium text-slate-700" htmlFor={`mix-${tier.key}`}>
                  {tier.label} · {sek(tier.listPriceSek)}
                </label>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {growth.newCustomerMix[tier.key]}%
                </span>
              </div>
              <input
                className="mt-1.5 w-full accent-indigo-600"
                id={`mix-${tier.key}`}
                max={100}
                min={0}
                onChange={(e) => setMix(tier.key)(Number(e.target.value))}
                step={1}
                type="range"
                value={growth.newCustomerMix[tier.key]}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Seeded from the{" "}
          {num(CAC_LTV_TIERS.reduce((s, t) => s + data.selfServeMixByTier[t.key], 0))}{" "}
          Stripe-billed customers acquired since {SELF_SERVE_START_LABEL} (paying or in
          trial) — the mix self-serve acquisition actually produces. Deliberately not
          the whole paying base, which carries Large accounts provisioned by hand that
          ads did not produce. Mix is the most powerful control here: One and Large
          differ ~10x in what they can support, so shifting these sliders moves the
          outcome more than doubling the budget does.
        </p>
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Paying customers over time
          </p>
          <PayerGrowthChart result={result} />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Cumulative spend vs cumulative gross profit
          </p>
          <CashChart result={result} />
        </div>
      </div>

      {/* Month table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="py-2 pr-3">Month</th>
              <th className="py-2 pr-3 text-right">Spend</th>
              <th className="py-2 pr-3 text-right">Signups</th>
              <th className="py-2 pr-3 text-right">Free added</th>
              <th className="py-2 pr-3 text-right">New payers</th>
              <th className="py-2 pr-3 text-right">Churned</th>
              <th className="py-2 pr-3 text-right">Payer base</th>
              <th className="py-2 pr-3 text-right">MRR</th>
              <th className="py-2 pr-3 text-right">Gross profit</th>
              <th className="py-2 pr-3 text-right">Net this month</th>
              <th className="py-2 pr-3 text-right">Cumulative net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tableRows.map((row) => (
              <tr
                className={
                  result.paybackMonth === row.month ? "bg-emerald-50 font-semibold" : ""
                }
                key={row.month}
              >
                <td className="py-2 pr-3 font-medium text-slate-900">{row.month}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                  {sek(row.spendSek)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-900">
                  {num(row.signups)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-400">
                  {num(row.freeAdded)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">
                  {row.newPayers.toFixed(1)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-rose-600">
                  {row.churnedPayers > 0 ? `−${row.churnedPayers.toFixed(1)}` : "0"}
                </td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums text-slate-900">
                  {num(row.payerBase)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-900">
                  {sek(row.mrrSek)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                  {sek(row.grossProfitSek)}
                </td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    row.netContributionSek >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {sek(row.netContributionSek)}
                </td>
                <td
                  className={`py-2 pr-3 text-right font-medium tabular-nums ${
                    row.cumulativeNetSek >= 0 ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {sek(row.cumulativeNetSek)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        Incremental on purpose: the projection starts from zero payers and models
        only what this spend buys, so today&rsquo;s existing base cannot flatter it.
        Cost per signup, conversion, churn, discount and premium-data cost all come
        from the Assumptions panel above, so changing one there changes this too.
        Constant spend and a constant conversion rate are simplifications — real
        campaigns get more expensive as you scale past the cheapest audience, which
        this does not model.
      </p>
    </Panel>
  );
}

function FunnelStep({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good";
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === "good" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
      }`}
    >
      <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={`block text-base font-semibold tabular-nums ${
          tone === "good" ? "text-emerald-800" : "text-slate-900"
        }`}
      >
        {value}
      </span>
      <span className="block text-[10px] text-slate-500">{sub}</span>
    </div>
  );
}

function StepArrow({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center px-1">
      <ArrowRight className="h-4 w-4 text-slate-400" />
      <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium tabular-nums text-slate-500">
        {note}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function CacLtvContent({ data }: { data: CacLtvData }) {
  // Conversion is seeded from the mature cohorts rather than the constant, so
  // the page opens on what the funnel actually did.
  const seededAssumptions: CacLtvAssumptions = useMemo(
    () => ({
      ...DEFAULT_ASSUMPTIONS,
      signupToPaidPct:
        data.matureSignupToPaidPct !== null
          ? Number(data.matureSignupToPaidPct.toFixed(1))
          : DEFAULT_ASSUMPTIONS.signupToPaidPct,
    }),
    [data.matureSignupToPaidPct],
  );

  const [assumptions, setAssumptions] = useState<CacLtvAssumptions>(seededAssumptions);
  const [gridMetric, setGridMetric] = useState<"payback" | "ltvcac">("payback");

  const set = (field: keyof CacLtvAssumptions) => (next: number) =>
    setAssumptions((current) => ({ ...current, [field]: next }));

  // AI cost per paying customer per month, from observed diagnostics volume.
  const aiCostPerMonthSek = useMemo(
    () =>
      data.diagnosticsPerPayingWorkshopPerMonth *
      data.aiCostPerDiagnosticUsd *
      assumptions.sekPerUsd,
    [data.diagnosticsPerPayingWorkshopPerMonth, data.aiCostPerDiagnosticUsd, assumptions.sekPerUsd],
  );

  const tiers: TierEconomics[] = useMemo(
    () =>
      CAC_LTV_TIERS.map((tier) =>
        computeTierEconomics(tier, assumptions, {
          vehiclesPerMonth: data.vehiclesPerMonthByTier[tier.key],
          aiCostPerMonthSek,
          payingNow: data.payingByTier[tier.key],
        }),
      ),
    [assumptions, data.vehiclesPerMonthByTier, data.payingByTier, aiCostPerMonthSek],
  );

  const blended = useMemo(() => blendTiers(tiers, assumptions), [tiers, assumptions]);
  const headline = blended ?? tiers[1];

  const cac = cacPerCustomer(assumptions.cacPerSignupSek, assumptions.signupToPaidPct);
  const churnCeiling = maxSurvivableChurnPct(cac, headline.grossProfitSek);
  const neededConversionFor3x = requiredConversionPct(
    assumptions.cacPerSignupSek,
    headline.grossProfitSek,
    assumptions.monthlyChurnPct,
    3,
  );

  const verdict = (() => {
    if (headline.breakEvenMonths === null) {
      return {
        tone: "bad" as const,
        title: "Never pays back",
        body: `At ${sek(assumptions.cacPerSignupSek)} per registered customer and ${pct(assumptions.signupToPaidPct)} signup-to-paid, each payer costs ${sek(cac)} to acquire — more than the ${sek(headline.ltvSek)} of gross profit they will ever produce at ${pct(assumptions.monthlyChurnPct)} monthly churn. Churn has to come below ${pct(churnCeiling)} before this CAC can be repaid at all.`,
      };
    }
    if (headline.ltvCac >= 3) {
      return {
        tone: "good" as const,
        title: `Profitable after ${headline.breakEvenMonths.toFixed(1)} months`,
        body: `Each payer costs ${sek(cac)} and returns ${sek(headline.ltvSek)} in gross profit, an LTV:CAC of ${headline.ltvCac.toFixed(1)}x. That clears the 3x bar, so this is a channel to scale rather than fix.`,
      };
    }
    return {
      tone: "warn" as const,
      title: `Pays back after ${headline.breakEvenMonths.toFixed(1)} months, but thin`,
      body: `LTV:CAC is ${headline.ltvCac.toFixed(1)}x against a 3x bar. It works, but there is not enough margin to absorb a worse month. ${neededConversionFor3x !== null ? `Signup-to-paid would have to reach ${pct(neededConversionFor3x)} to hit 3x at this cost per signup.` : ""}`,
    };
  })();

  const verdictStyle = {
    good: "border-emerald-200 bg-emerald-50",
    warn: "border-amber-200 bg-amber-50",
    bad: "border-rose-200 bg-rose-50",
  }[verdict.tone];

  const verdictTitleStyle = {
    good: "text-emerald-900",
    warn: "text-amber-900",
    bad: "text-rose-900",
  }[verdict.tone];

  const basis = data.conversionBasis;
  const recentMonths = data.months.slice(-8);

  // The window is half-open, so show the last day actually counted rather than
  // the exclusive boundary — "to 2026-08-01" reads as if August is included.
  // Capped at the data's own as-of stamp rather than the browser clock, so the
  // label always matches the snapshot the numbers came from.
  const rangeEndLabel = useMemo(() => {
    const end = new Date(`${data.range.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const asOf = new Date(data.asOf);
    return (end.getTime() > asOf.getTime() ? asOf : end).toISOString().slice(0, 10);
  }, [data.range.to, data.asOf]);
  const activePresetHint = CAC_LTV_RANGE_PRESETS.find(
    (preset) => preset.key === data.rangePresetKey,
  )?.hint;

  // A short window can contain plenty of signups and still measure nothing,
  // because none of them are old enough to have converted. When that happens the
  // conversion input falls back to a constant, and that must never be presented
  // as a measurement.
  const conversionMeasured = basis.selfServePct !== null && basis.agedSignups > 0;
  const totalPastDue = CAC_LTV_TIERS.reduce(
    (sum, tier) => sum + data.pastDueByTier[tier.key],
    0,
  );
  const totalTrialing = CAC_LTV_TIERS.reduce(
    (sum, tier) => sum + data.trialingByTier[tier.key],
    0,
  );

  const priceChanged = CAC_LTV_TIERS.some(
    (tier) => assumptions.tierPricesSek[tier.key] !== LIST_PRICES_SEK[tier.key],
  );

  // Which inputs have been moved off their actual value, and the same model run
  // at those actuals — so every headline number can show "now" beside the
  // scenario instead of leaving the reader to remember what it said before.
  const changedFields = useMemo(() => {
    const labels: string[] = [];
    for (const key of Object.keys(ASSUMPTION_BOUNDS) as Array<
      Exclude<keyof CacLtvAssumptions, "tierPricesSek">
    >) {
      if (assumptions[key] !== seededAssumptions[key]) labels.push(ASSUMPTION_BOUNDS[key].label);
    }
    if (priceChanged) labels.push("plan prices");
    return labels;
  }, [assumptions, seededAssumptions, priceChanged]);
  const isModelling = changedFields.length > 0;

  const baselineTiers = useMemo(
    () =>
      CAC_LTV_TIERS.map((tier) =>
        computeTierEconomics(tier, seededAssumptions, {
          vehiclesPerMonth: data.vehiclesPerMonthByTier[tier.key],
          aiCostPerMonthSek:
            data.diagnosticsPerPayingWorkshopPerMonth *
            data.aiCostPerDiagnosticUsd *
            seededAssumptions.sekPerUsd,
          payingNow: data.payingByTier[tier.key],
        }),
      ),
    [seededAssumptions, data],
  );
  const baselineHeadline = useMemo(
    () => blendTiers(baselineTiers, seededAssumptions) ?? baselineTiers[1],
    [baselineTiers, seededAssumptions],
  );
  const baselineCac = cacPerCustomer(
    seededAssumptions.cacPerSignupSek,
    seededAssumptions.signupToPaidPct,
  );

  const affordableFor = (tier: TierEconomics) =>
    affordableCostPerSignup(
      tier.grossProfitSek,
      assumptions.monthlyChurnPct,
      assumptions.signupToPaidPct,
      TARGET_LTV_CAC,
    );

  // The per-product spread is the actionable finding: the same blended cost per
  // registration can be comfortable for Small and ruinous for One.
  const cheapestTier = tiers.reduce((worst, tier) => {
    const a = affordableFor(tier);
    const b = affordableFor(worst);
    if (a === null) return worst;
    if (b === null) return tier;
    return a < b ? tier : worst;
  }, tiers[0]);
  const cheapestAffordable = affordableFor(cheapestTier);
  const richestTier = tiers.reduce((best, tier) => {
    const a = affordableFor(tier);
    const b = affordableFor(best);
    if (a === null) return best;
    if (b === null) return tier;
    return a > b ? tier : best;
  }, tiers[0]);
  const richestAffordable = affordableFor(richestTier);

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* The question                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          The question this page answers
        </p>
        <blockquote className="mt-2 border-l-2 border-indigo-300 pl-3 text-sm italic leading-relaxed text-slate-700">
          &ldquo;Vill kunna svara på frågan. Om ni har 100kr per reggad kund, när blir
          den lönsam? samt förstå hur vi internt ska optimera.&rdquo;
        </blockquote>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-slate-600">
          100 kr per registered customer is not a 100 kr CAC. A registration is a
          free signup, and only a fraction of free signups ever pay, so the cost
          of a <em>paying</em> customer is 100 kr divided by that conversion rate.
          Everything below follows from that one division. Move the sliders to see
          what has to be true for it to work.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Answer                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className={`rounded-xl border p-5 shadow-sm ${verdictStyle}`}>
        {/* The verdict is only as good as the conversion rate under it. When the
            window cannot supply one, say so HERE rather than only further down —
            a confident green headline above a warning nobody scrolls to is worse
            than no headline at all. */}
        {!conversionMeasured ? (
          <div className="mb-3 flex gap-2 rounded-lg border border-rose-300 bg-rose-100 p-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <p className="text-xs leading-relaxed text-rose-900">
              <strong className="font-semibold">This verdict is not measured.</strong>{" "}
              The selected window has no signups old enough to have converted, so the
              conversion rate is a placeholder and every number below it is
              hypothetical. Switch to a window ending {basis.windowDays}+ days ago.
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={`text-lg font-semibold ${verdictTitleStyle}`}>{verdict.title}</h2>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            blended plan mix · {num(headline.payingNow)} payers today
          </span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {data.range.from} → {rangeEndLabel}
          </span>
        </div>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-700">{verdict.body}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            hint={`${sek(assumptions.cacPerSignupSek)} per signup ÷ ${pct(assumptions.signupToPaidPct)}`}
            label="CAC per paying customer"
            now={sek(baselineCac)}
            value={sek(cac)}
          />
          <Stat
            hint={`${sek(headline.grossProfitSek)} gross profit/mo, survival-weighted`}
            label="Break-even"
            now={months(baselineHeadline.breakEvenMonths)}
            tone={headline.breakEvenMonths === null ? "bad" : headline.breakEvenMonths <= 12 ? "good" : "warn"}
            value={months(headline.breakEvenMonths)}
          />
          <Stat
            hint={`Gross-profit LTV at ${pct(assumptions.monthlyChurnPct)} churn`}
            label="LTV"
            now={sek(baselineHeadline.ltvSek)}
            value={sek(headline.ltvSek)}
          />
          <Stat
            hint="3x or better is the bar"
            label="LTV:CAC"
            now={`${baselineHeadline.ltvCac.toFixed(1)}x`}
            tone={headline.ltvCac >= 3 ? "good" : headline.ltvCac >= 1 ? "warn" : "bad"}
            value={`${headline.ltvCac.toFixed(1)}x`}
          />
          <Stat
            hint="Above this, the CAC is never repaid"
            label="Max survivable churn"
            now={pct(maxSurvivableChurnPct(baselineCac, baselineHeadline.grossProfitSek))}
            tone="neutral"
            value={pct(churnCeiling)}
          />
        </div>

        {cheapestAffordable !== null && richestAffordable !== null ? (
          <div className="mt-4 rounded-lg border border-white/60 bg-white/60 p-3">
            <p className="text-xs leading-relaxed text-slate-700">
              <strong className="font-semibold">
                One number cannot answer this for all three tiers.
              </strong>{" "}
              A blended {sek(assumptions.cacPerSignupSek)} per registration is
              spent at the same rate on every plan, but{" "}
              <strong>{richestTier.label}</strong> can afford up to{" "}
              <strong className="tabular-nums">{sek(richestAffordable)}</strong> per
              registration at {TARGET_LTV_CAC}x, while{" "}
              <strong>{cheapestTier.label}</strong> can only afford{" "}
              <strong className="tabular-nums">{sek(cheapestAffordable)}</strong> —
              a {(richestAffordable / Math.max(cheapestAffordable, 1)).toFixed(0)}x
              spread. At today&rsquo;s cost {cheapestTier.label} breaks even after{" "}
              <strong className="tabular-nums">{months(cheapestTier.breakEvenMonths)}</strong>{" "}
              against {richestTier.label}&rsquo;s{" "}
              <strong className="tabular-nums">{months(richestTier.breakEvenMonths)}</strong>.
              That is the arithmetic behind splitting the campaigns and landing
              pages per product: it is a requirement for {cheapestTier.label} to
              work at all, not a reporting nicety.
            </p>
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-white/60 bg-white/60 p-3">
          <p className="text-xs leading-relaxed text-slate-700">
            <strong className="font-semibold">The spreadsheet reads this too kindly.</strong>{" "}
            &lsquo;Channel Economics&rsquo; column M computes payback as CAC ÷ monthly
            gross profit, which is{" "}
            <strong className="tabular-nums">{months(headline.naivePaybackMonths)}</strong>{" "}
            here. That assumes nobody ever cancels. Weighting each month by
            survival gives{" "}
            <strong className="tabular-nums">{months(headline.breakEvenMonths)}</strong>
            {headline.breakEvenMonths === null
              ? " — the cohort dies before it repays."
              : ` — ${(headline.breakEvenMonths / (headline.naivePaybackMonths ?? 1)).toFixed(1)}x longer.`}
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Measurement window                                               */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Measurement window
            </p>
            <h2 className="text-base font-semibold text-slate-900">
              {data.range.from} to {rangeEndLabel}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              Everything measured from history — traffic, spend, signups, the
              conversion rate and the monthly funnel — is counted over this window.
              Plan state (who is paying or trialing right now), churn tenure and
              premium-data usage are always <strong>as of today</strong>, because they
              describe the present rather than a period; those are labelled where
              they appear.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {CAC_LTV_RANGE_PRESETS.map((preset) => {
            const active = preset.key === data.rangePresetKey;
            return (
              <Link
                // The `!` modifiers are load-bearing: ceo-legacy.css carries an
                // UNLAYERED `a { color: inherit }`, and unlayered rules beat
                // Tailwind's layered utilities regardless of specificity. Without
                // them the active pill renders black-on-black and is unreadable.
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-slate-900 bg-slate-900 !text-white"
                    : "border-slate-300 bg-white !text-slate-700 hover:bg-slate-50"
                }`}
                href={
                  preset.key === DEFAULT_RANGE_PRESET_KEY
                    ? "/dashboard/cac-ltv"
                    : `/dashboard/cac-ltv?window=${preset.key}`
                }
                key={preset.key}
                title={preset.hint}
              >
                {preset.label}
              </Link>
            );
          })}
        </div>
        {activePresetHint ? (
          <p className="mt-2 text-[11px] leading-snug text-slate-500">{activePresetHint}</p>
        ) : null}

        {!conversionMeasured ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
            <p className="text-xs leading-relaxed text-rose-900">
              <strong className="font-semibold">
                Conversion cannot be measured in this window.
              </strong>{" "}
              It contains {num(basis.signupsInRange)} signups but none are yet{" "}
              {basis.windowDays} days old, so none have had time to finish a trial and
              pay. The signup → paying rate below therefore shows{" "}
              {pct(DEFAULT_ASSUMPTIONS.signupToPaidPct)}, which is a placeholder
              constant and <strong>not a measurement</strong> — and every figure derived
              from it (CAC per payer, LTV:CAC, break-even, the whole growth projection)
              inherits that. Choose a window ending at least {basis.windowDays} days ago
              to get a real rate.
            </p>
          </div>
        ) : null}

        {/* Coverage — "do we actually have the data for this window". */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Feeds</th>
                <th className="py-2 pr-3">Days with data</th>
                <th className="py-2 pr-3">First → last in window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.coverage.map((row) => (
                <tr key={row.key}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                          row.status === "complete"
                            ? "bg-emerald-500"
                            : row.status === "partial"
                              ? "bg-amber-500"
                              : "bg-rose-500"
                        }`}
                      />
                      <span className="font-medium text-slate-900">{row.label}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-600">{row.feeds}</td>
                  <td
                    className={`py-2.5 pr-3 tabular-nums ${
                      row.status === "complete" ? "text-slate-600" : "font-semibold text-amber-700"
                    }`}
                  >
                    {num(row.daysPresent)} / {num(row.daysExpected)}
                  </td>
                  <td className="py-2.5 pr-3 text-xs tabular-nums text-slate-600">
                    {row.firstDayInRange ? `${row.firstDayInRange} → ${row.lastDayInRange}` : "—"}
                    {row.windowPredatesSource && row.sourceFirstEverDay ? (
                      <span className="mt-0.5 block text-[10px] text-amber-700">
                        source starts {row.sourceFirstEverDay}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.coverage.some((row) => row.note && row.status !== "complete") ? (
          <div className="mt-3 space-y-2">
            {data.coverage
              .filter((row) => row.note && row.status !== "complete")
              .map((row) => (
                <div
                  className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
                  key={row.key}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <p className="text-[11px] leading-relaxed text-amber-900">
                    <strong className="font-semibold">{row.label}:</strong> {row.note}
                  </p>
                </div>
              ))}
          </div>
        ) : null}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          A green dot means every day in the window has a row. Amber means some days
          are absent — which for GA4 sign_up events means a genuine zero rather than a
          gap, and for ad-attributed signups means the metric did not exist yet.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Where the numbers come from                                      */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="Every figure above, traced back to the rows it was counted from. Measured values are stated with their base so the sample size is never hidden."
        eyebrow="Show your work"
        title="Where these numbers come from"
      >
        <div className="mb-5">
          <p className="text-xs font-semibold text-slate-700">
            The measured funnel — {num(basis.agedSignups)} signups old enough to have
            converted
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
            Of the <strong>{num(basis.signupsInRange)}</strong> workshops that signed up
            inside the selected window ({data.range.from} to {rangeEndLabel}),{" "}
            <strong>{num(basis.agedSignups)}</strong> are at least {basis.windowDays} days
            old — a 14-day trial plus about one invoice cycle — so nothing is judged
            before it had the chance to pay. Actual signups counted:{" "}
            {basis.firstSignup} to {basis.lastSignup}. Internal-test accounts excluded.
            {basis.signupsInRange > basis.agedSignups ? (
              <>
                {" "}
                The other{" "}
                <strong>{num(basis.signupsInRange - basis.agedSignups)}</strong> are too
                recent to count yet; they will pull the rate up or down as they mature.
              </>
            ) : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-3">
            <FunnelStep label="Signed up" sub="on Free" value={num(basis.agedSignups)} />
            <StepArrow note={pct(basis.checkoutPct, 1)} />
            <FunnelStep
              label="Reached checkout"
              sub="Stripe customer"
              value={num(basis.reachedCheckout)}
            />
            <StepArrow note={pct(basis.trialPct, 1)} />
            <FunnelStep
              label="Started a trial"
              sub="card on file"
              value={num(basis.startedTrial)}
            />
            <StepArrow note={pct(basis.selfServePct, 2)} />
            <FunnelStep
              label="Paying today"
              sub="Stripe-billed"
              tone="good"
              value={num(basis.payingSelfServe)}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            The percentages under each arrow are all measured against the{" "}
            <strong>{num(basis.agedSignups)}</strong> signups, not against the previous
            step, so they can be read directly as &ldquo;X% of everything we bought&rdquo;.
            So the{" "}
            <strong className="text-slate-900">
              {pct(basis.selfServePct, 1)} signup → paying
            </strong>{" "}
            rate is {num(basis.payingSelfServe)} paying customers out of{" "}
            {num(basis.agedSignups)} signups. It is a real count, not a forecast — but it
            is {num(basis.payingSelfServe)} customers, so treat one more or fewer as
            meaningful movement.
          </p>
          {basis.payingManual > 0 ? (
            <div className="mt-3 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p className="text-xs leading-relaxed text-amber-900">
                <strong className="font-semibold">
                  Why this is {pct(basis.selfServePct, 1)} and not {pct(basis.inflatedPct, 1)}.
                </strong>{" "}
                A further {basis.payingManual} paying workshop
                {basis.payingManual === 1 ? "" : "s"} in this window carry no Stripe
                customer or subscription id at all, so they never went through checkout —
                they were provisioned by hand (comped, pilot, or closed by a person).
                Counting them as acquisition would read {pct(basis.inflatedPct, 1)}, and
                they sit mostly in Large, the tier ads do not produce. They are real
                revenue, just not something a signup budget bought.
              </p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold text-slate-700">
            How each headline number is built
          </p>
          <div className="mt-2 space-y-2">
            {[
              {
                name: "CAC per paying customer",
                formula: "cost per signup ÷ signup→paying",
                worked: `${sek(assumptions.cacPerSignupSek)} ÷ ${pct(assumptions.signupToPaidPct, 2)} = ${sek(cac)}`,
                why: "The step the whole question turns on. Buying a payer means buying all the signups that did not convert too.",
              },
              {
                name: "Net ARPA",
                formula: "list price × (1 − discount)",
                worked: `blended ${sek(headline.netArpaSek)} across the ${num(headline.payingNow)} paying customers today`,
                why: "SEK list prices, cross-checked against Stripe price ids. Yearly plans are counted at their monthly equivalent.",
              },
              {
                name: "Gross profit / month",
                formula: "net ARPA − AI − premium data − payment fees",
                worked: `${sek(headline.netArpaSek)} − ${sek(headline.variableCostSek)} = ${sek(headline.grossProfitSek)} (${pct(headline.grossMarginPct, 0)} margin)`,
                why: "AI is measured and tiny. Premium vehicle data is measured in volume but its unit rate is an assumption — the biggest hole in the model.",
              },
              {
                name: "LTV",
                formula: "monthly gross profit ÷ monthly churn",
                worked: `${sek(headline.grossProfitSek)} ÷ ${pct(assumptions.monthlyChurnPct)} = ${sek(headline.ltvSek)}`,
                why: "Gross-profit LTV, not revenue LTV. Churn is the least-evidenced input on the page, so treat this as a scenario.",
              },
              {
                name: "Break-even",
                formula: "months until survival-weighted gross profit repays CAC",
                worked:
                  headline.breakEvenMonths === null
                    ? "never — CAC is at or above LTV"
                    : `${months(headline.breakEvenMonths)} (the workbook's CAC ÷ gross profit would say ${months(headline.naivePaybackMonths)})`,
                why: "Each future month is discounted by the chance the customer is still there, which is why it is slower than the naive figure.",
              },
              {
                name: "LTV:CAC",
                formula: "LTV ÷ CAC per paying customer",
                worked: `${sek(headline.ltvSek)} ÷ ${sek(cac)} = ${headline.ltvCac.toFixed(1)}x`,
                why: `3x is the conventional bar. Below 1x the customer is bought at a loss for life.`,
              },
            ].map((row) => (
              <div className="rounded-lg border border-slate-200 p-3" key={row.name}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <strong className="text-xs font-semibold text-slate-900">{row.name}</strong>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                    {row.formula}
                  </code>
                </div>
                <p className="mt-1 text-xs font-medium tabular-nums text-slate-900">
                  {row.worked}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{row.why}</p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Assumptions                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        actions={
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => setAssumptions(seededAssumptions)}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        }
        description="Blue-font cells in the CEO's workbook. Every control shows its current actual value as a tick on the track and as 'Now:' underneath, so it is always clear what is real and what you have changed. Two are measured from prod; the rest are genuinely unknown and are yours to argue about."
        eyebrow="Inputs"
        title="Assumptions"
      >
        {isModelling ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
            <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              Modelling
            </span>
            <span className="text-xs text-indigo-900">
              {changedFields.length} input{changedFields.length === 1 ? "" : "s"} changed from
              actual: {changedFields.join(", ")}. Everything below reflects your
              scenario, not today.
            </span>
          </div>
        ) : (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white">
              Actual
            </span>
            <span className="text-xs text-slate-700">
              Every input is at its current measured or agreed value. This is the
              business as it stands today.
            </span>
          </div>
        )}

        <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-4">
          <Slider
            baseline={seededAssumptions.cacPerSignupSek}
            field="cacPerSignupSek"
            onChange={set("cacPerSignupSek")}
            seeded={
              data.blendedCostPerSignupSek !== null
                ? `Actually paid: ${sek(data.blendedCostPerSignupSek)} blended, ${sek(data.paidCostPerSignupSek ?? 0)} per ad-attributed signup.`
                : "No spend attributed yet."
            }
            value={assumptions.cacPerSignupSek}
          />
          <Slider
            baseline={seededAssumptions.signupToPaidPct}
            field="signupToPaidPct"
            onChange={set("signupToPaidPct")}
            baselineLabel={conversionMeasured ? undefined : "not measurable in this window"}
            seeded={
              conversionMeasured
                ? `Measured: ${num(basis.payingSelfServe)} Stripe-billed payers out of ${num(basis.agedSignups)} signups aged ${basis.windowDays}+ days. See "Where these numbers come from".`
                : `NOT measured — this window has no signups aged ${basis.windowDays}+ days, so ${pct(DEFAULT_ASSUMPTIONS.signupToPaidPct)} is a placeholder, not a fact. Pick a wider window.`
            }
            value={assumptions.signupToPaidPct}
          />
          <Slider
            baseline={seededAssumptions.monthlyChurnPct}
            field="monthlyChurnPct"
            onChange={set("monthlyChurnPct")}
            seeded={
              data.churn.observedMonthlyChurnPct !== null
                ? `Not reliably measured. Ordinary cancellations imply ~${pct(data.churn.observedMonthlyChurnPct, 0)}; see Churn evidence below.`
                : "Not measured. See Churn evidence below."
            }
            value={assumptions.monthlyChurnPct}
          />
          <Slider
            baseline={seededAssumptions.perVehicleDataCostSek}
            field="perVehicleDataCostSek"
            onChange={set("perVehicleDataCostSek")}
            seeded="Assumption. Supplier rate for one InfoPro/Motor lookup — exists in no table we sync."
            value={assumptions.perVehicleDataCostSek}
          />
          <Slider
            baseline={seededAssumptions.discountPct}
            field="discountPct"
            onChange={set("discountPct")}
            seeded="Assumption. Average realized discount off SEK list price."
            value={assumptions.discountPct}
          />
          <Slider
            baseline={seededAssumptions.stripeFeePct}
            field="stripeFeePct"
            onChange={set("stripeFeePct")}
            seeded="Assumption. Stripe's EU card rate is ~1.5% + fixed."
            value={assumptions.stripeFeePct}
          />
          <Slider
            baseline={seededAssumptions.stripeFeeFixedSek}
            field="stripeFeeFixedSek"
            onChange={set("stripeFeeFixedSek")}
            seeded="Assumption. Per-charge fixed fee."
            value={assumptions.stripeFeeFixedSek}
          />
          <Slider
            baseline={seededAssumptions.sekPerUsd}
            field="sekPerUsd"
            onChange={set("sekPerUsd")}
            seeded="Assumption. Ad spend and AI cost are synced in USD."
            value={assumptions.sekPerUsd}
          />
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Break-even curve                                                 */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="Cumulative gross profit from one acquired customer, month by month, with each month weighted by the chance they are still subscribed. The curve flattens onto the LTV ceiling — if the CAC line sits above that ceiling, no amount of patience repays it."
        eyebrow="When does it turn profitable"
        title="Payback curve"
      >
        <BreakEvenCurve
          breakEven={headline.breakEvenMonths}
          cacSek={cac}
          churnPct={assumptions.monthlyChurnPct}
          grossProfitSek={headline.grossProfitSek}
        />
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Spend → growth simulator                                         */}
      {/* ---------------------------------------------------------------- */}
      <GrowthSection
        aiCostPerMonthSek={aiCostPerMonthSek}
        assumptions={assumptions}
        data={data}
      />

      {/* ---------------------------------------------------------------- */}
      {/* Sensitivity grid                                                 */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        actions={
          <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
            {(
              [
                ["payback", "Break-even months"],
                ["ltvcac", "LTV:CAC"],
              ] as const
            ).map(([key, label]) => (
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  gridMetric === key
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
                key={key}
                onClick={() => setGridMetric(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        }
        description="Cost per registered customer against signup-to-paid conversion, at the blended plan mix and the churn on the slider. Every cell prints its own number, so colour only reinforces the reading. The marked cell is where the business sits today."
        eyebrow="What has to be true"
        title="Cost per registration × conversion"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0.5 text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-semibold text-slate-500">
                  Cost / registration
                </th>
                {SENSITIVITY_CONVERSION_PCT.map((conversion) => (
                  <th
                    className="p-2 text-center text-xs font-semibold text-slate-600 tabular-nums"
                    key={conversion}
                  >
                    {conversion}%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SENSITIVITY_CAC_SEK.map((cacPerSignup) => (
                <tr key={cacPerSignup}>
                  <th className="whitespace-nowrap p-2 text-left text-xs font-semibold text-slate-700 tabular-nums">
                    {sek(cacPerSignup)}
                  </th>
                  {SENSITIVITY_CONVERSION_PCT.map((conversion) => {
                    const cellCac = cacPerCustomer(cacPerSignup, conversion);
                    const payback = breakEvenMonths(
                      cellCac,
                      headline.grossProfitSek,
                      assumptions.monthlyChurnPct,
                    );
                    const ratio =
                      assumptions.monthlyChurnPct > 0 && cellCac > 0
                        ? headline.grossProfitSek / (assumptions.monthlyChurnPct / 100) / cellCac
                        : 0;
                    const band =
                      gridMetric === "payback" ? paybackBand(payback) : ltvCacBand(ratio);
                    const isCurrent =
                      Math.abs(cacPerSignup - assumptions.cacPerSignupSek) < 1 &&
                      Math.abs(conversion - assumptions.signupToPaidPct) < 0.3;

                    return (
                      <td
                        className={`rounded-md p-2 text-center text-xs font-semibold tabular-nums ${band.cell} ${band.text} ${
                          isCurrent ? "ring-2 ring-slate-900 ring-offset-1" : ""
                        }`}
                        key={conversion}
                        title={`${sek(cacPerSignup)} per registration at ${conversion}% conversion = ${sek(cellCac)} per payer`}
                      >
                        {gridMetric === "payback"
                          ? payback === null
                            ? "never"
                            : payback.toFixed(0)
                          : `${ratio.toFixed(1)}x`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          {gridMetric === "payback" ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-emerald-100" /> ≤ 6 mo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-sky-100" /> 6–12 mo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-amber-100" /> 12–24 mo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-rose-100" /> &gt; 24 mo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-rose-600" /> never
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-emerald-100" /> ≥ 3x
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-sky-100" /> 2–3x
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-amber-100" /> 1–2x
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-rose-100" /> &lt; 1x
              </span>
            </>
          )}
        </div>

        {/* Churn row — the third axis, which is the one nobody can pin down. */}
        <div className="mt-5 border-t border-slate-200 pt-4">
          <p className="text-xs font-semibold text-slate-700">
            Same cost per registration ({sek(assumptions.cacPerSignupSek)}) and conversion
            ({pct(assumptions.signupToPaidPct)}), churn varied
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SENSITIVITY_CHURN_PCT.map((churnPct) => {
              const payback = breakEvenMonths(cac, headline.grossProfitSek, churnPct);
              const band = paybackBand(payback);
              return (
                <button
                  className={`rounded-lg px-3 py-2 text-left ${band.cell} ${band.text} ${
                    Math.abs(churnPct - assumptions.monthlyChurnPct) < 0.3
                      ? "ring-2 ring-slate-900 ring-offset-1"
                      : ""
                  }`}
                  key={churnPct}
                  onClick={() => set("monthlyChurnPct")(churnPct)}
                  type="button"
                >
                  <span className="block text-[11px] font-medium opacity-80">
                    {churnPct}% / mo
                  </span>
                  <span className="block text-sm font-semibold tabular-nums">
                    {payback === null ? "never" : `${payback.toFixed(1)} mo`}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            At the blended plan mix the answer is robust to churn — gross profit per
            month is large enough relative to CAC that even a bad rate still repays.
            That is not true tier by tier: see the per-tier churn ceilings under
            Churn evidence. Click a tile to load it into the model.
          </p>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Unit economics per tier                                          */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        actions={
          priceChanged ? (
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              onClick={() =>
                setAssumptions((cur) => ({ ...cur, tierPricesSek: { ...LIST_PRICES_SEK } }))
              }
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Back to live prices
            </button>
          ) : null
        }
        description="The CEO workbook's 'Economics Assumptions' sheet, per tier, with variable cost broken into its three real parts. Prices are adjustable — drag them to see how a different price moves gross profit, LTV, LTV:CAC and payback. Note that gross margin is DERIVED here and churn is the input; the workbook has those two swapped, which turns its LTV formula upside down."
        eyebrow="Product unit economics"
        title="One, Small and Large"
      >
        {/* Price controls. Kept above the table so the cause sits next to the
            effect, and the delta against the live Stripe price is always shown
            so nobody mistakes a modelled price for what we actually charge. */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700">Monthly price per plan</p>
            {priceChanged ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Modelling prices that differ from Stripe
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Matching what Stripe bills today
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {CAC_LTV_TIERS.map((tier) => {
              const current = assumptions.tierPricesSek[tier.key];
              const delta = current - tier.listPriceSek;
              const needed = requiredPriceForTarget(
                tier.key,
                assumptions,
                data.vehiclesPerMonthByTier[tier.key],
                aiCostPerMonthSek,
                TARGET_LTV_CAC,
              );
              return (
                <div key={tier.key}>
                  <Slider
                    bounds={PRICE_BOUNDS[tier.key]}
                    id={`price-${tier.key}`}
                    onChange={(next) =>
                      setAssumptions((cur) => ({
                        ...cur,
                        tierPricesSek: { ...cur.tierPricesSek, [tier.key]: next },
                      }))
                    }
                    value={current}
                  />
                  <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    Live {sek(tier.listPriceSek)}
                    {delta !== 0 ? (
                      <span
                        className={`ml-1 font-semibold ${delta > 0 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        ({delta > 0 ? "+" : "−"}
                        {sek(Math.abs(delta))})
                      </span>
                    ) : null}
                    {needed !== null && needed > 0 ? (
                      <>
                        {" · "}
                        needs{" "}
                        <strong
                          className={
                            needed > current ? "text-rose-700" : "text-emerald-700"
                          }
                        >
                          {sek(needed)}
                        </strong>{" "}
                        for {TARGET_LTV_CAC}x
                      </>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
            &ldquo;Needs X for {TARGET_LTV_CAC}x&rdquo; is the inverse of the whole
            model: at {sek(assumptions.cacPerSignupSek)} per registration,{" "}
            {pct(assumptions.signupToPaidPct)} conversion and{" "}
            {pct(assumptions.monthlyChurnPct)} churn, that is the price the tier
            would have to carry. Where it sits above the live price, the tier is
            being acquired more expensively than its price can support — the fix is
            either a cheaper signup, better conversion, or that price. Nothing here
            touches Stripe.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3 text-right">List / mo</th>
                <th className="py-2 pr-3 text-right">Net ARPA</th>
                <th className="py-2 pr-3 text-right">Vehicles / mo</th>
                <th className="py-2 pr-3 text-right">Variable cost</th>
                <th className="py-2 pr-3 text-right">Gross profit</th>
                <th className="py-2 pr-3 text-right">Margin</th>
                <th className="py-2 pr-3 text-right">LTV</th>
                <th className="py-2 pr-3 text-right">LTV:CAC</th>
                <th className="py-2 pr-3 text-right">Break-even</th>
                <th
                  className="py-2 pr-3 text-right"
                  title={`The most a registration may cost for this tier to reach ${TARGET_LTV_CAC}x LTV:CAC at the current conversion and churn.`}
                >
                  Affordable / reg
                </th>
                <th className="py-2 pr-3 text-right">Paying</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tiers.map((tier) => (
                <tr key={tier.key}>
                  <td className="py-2.5 pr-3 font-semibold text-slate-900">{tier.label}</td>
                  <td
                    className={`py-2.5 pr-3 text-right tabular-nums ${
                      tier.listPriceSek !== tier.actualListPriceSek
                        ? "font-semibold text-amber-700"
                        : "text-slate-600"
                    }`}
                    title={
                      tier.listPriceSek !== tier.actualListPriceSek
                        ? `Modelled. Stripe bills ${sek(tier.actualListPriceSek)} today.`
                        : "Matches what Stripe bills today."
                    }
                  >
                    {sek(tier.listPriceSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {sek(tier.netArpaSek)}
                  </td>
                  <td
                    className="py-2.5 pr-3 text-right tabular-nums text-slate-600"
                    title={
                      data.vehicleEstimatedByTier[tier.key]
                        ? `Only ${data.vehicleSampleByTier[tier.key]} workshop-month(s) of real usage on record — below the ${MIN_VEHICLE_SAMPLE}-sample floor — so this is the plan's own vehicle allowance, not an observed average. Data cost ${sek(tier.dataCostSek)}.`
                        : `Observed InfoPro + Motor vehicle opens per paying workshop per month, across ${data.vehicleSampleByTier[tier.key]} workshop-months. Data cost ${sek(tier.dataCostSek)}.`
                    }
                  >
                    {tier.vehiclesPerMonth.toFixed(1)}
                    {data.vehicleEstimatedByTier[tier.key] ? (
                      <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">
                        est.
                      </span>
                    ) : (
                      <span className="ml-1 text-[10px] font-normal text-slate-400">
                        n={data.vehicleSampleByTier[tier.key]}
                      </span>
                    )}
                  </td>
                  <td
                    className="py-2.5 pr-3 text-right tabular-nums text-slate-600"
                    title={`AI ${sek(tier.aiCostSek, 2)} + premium data ${sek(tier.dataCostSek)} + payment fees ${sek(tier.paymentFeeSek)}`}
                  >
                    {sek(tier.variableCostSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-semibold tabular-nums text-slate-900">
                    {sek(tier.grossProfitSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {pct(tier.grossMarginPct, 0)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {sek(tier.ltvSek)}
                  </td>
                  <td
                    className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${
                      tier.ltvCac >= 3
                        ? "text-emerald-700"
                        : tier.ltvCac >= 1
                          ? "text-amber-700"
                          : "text-rose-700"
                    }`}
                  >
                    {tier.ltvCac.toFixed(1)}x
                  </td>
                  <td
                    className={`py-2.5 pr-3 text-right tabular-nums ${
                      tier.breakEvenMonths === null ? "font-semibold text-rose-700" : "text-slate-900"
                    }`}
                  >
                    {months(tier.breakEvenMonths)}
                  </td>
                  <td
                    className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${
                      affordableFor(tier) !== null &&
                      affordableFor(tier)! < assumptions.cacPerSignupSek
                        ? "text-rose-700"
                        : "text-emerald-700"
                    }`}
                    title={`Paying more than this per registration puts ${tier.label} below ${TARGET_LTV_CAC}x LTV:CAC. Currently paying ${sek(assumptions.cacPerSignupSek)}.`}
                  >
                    {affordableFor(tier) !== null ? sek(affordableFor(tier)!) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {num(tier.payingNow)}
                  </td>
                </tr>
              ))}
              {blended ? (
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2.5 pr-3 text-slate-900">Blended</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {sek(blended.listPriceSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {sek(blended.netArpaSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {blended.vehiclesPerMonth.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {sek(blended.variableCostSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {sek(blended.grossProfitSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {pct(blended.grossMarginPct, 0)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {sek(blended.ltvSek)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {blended.ltvCac.toFixed(1)}x
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {months(blended.breakEvenMonths)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                    {affordableFor(blended) !== null ? sek(affordableFor(blended)!) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {num(blended.payingNow)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          AI compute is {sek(aiCostPerMonthSek, 2)} per paying customer per month —
          lifetime AI spend across the whole product is ${data.aiCostLifetimeUsd.toFixed(2)},
          about ${data.aiCostPerDiagnosticUsd.toFixed(3)} per diagnostic. Premium
          vehicle data is the real variable cost, and its unit rate is the one
          number here that comes from an assumption rather than a table.{" "}
          <strong className="font-semibold">Paying</strong> counts Stripe status
          active only. A further {num(totalPastDue)} workshop
          {totalPastDue === 1 ? " sits" : "s sit"} on a paid plan with a failing
          charge and {totalPastDue === 1 ? "is" : "are"} excluded — they are churn
          risk, not revenue. {num(totalTrialing)} more are inside the 14-day trial.
        </p>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Funnel                                                           */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="The CEO workbook's 'Funnel Input' sheet, filled from prod. WrenchLane has one funnel, not two: every signup lands on Free, upgrading starts a 14-day card trial, cancelling reverts to Free. The workbook's separate 'ONE Trials' / 'Small Trials' columns describe a direct-paid-signup flow the product does not have."
        eyebrow="Live funnel"
        title="Traffic → signup → trial → paying, by month"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 pr-3 text-right">Traffic</th>
                <th className="py-2 pr-3 text-right">Ad spend</th>
                <th className="py-2 pr-3 text-right">Ad signups</th>
                <th className="py-2 pr-3 text-right">Cost / ad signup</th>
                <th className="py-2 pr-3 text-right">Signups</th>
                <th className="py-2 pr-3 text-right">Checkout</th>
                <th className="py-2 pr-3 text-right">Trial</th>
                <th className="py-2 pr-3 text-right">Paying</th>
                <th className="py-2 pr-3 text-right">Signup→paid</th>
                <th className="py-2 pr-3 text-right">Activated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentMonths.map((row) => {
                const spendSek = row.adSpendUsd * assumptions.sekPerUsd;
                const costPerAdSignup = row.adSignups > 0 ? spendSek / row.adSignups : null;
                const paidRate =
                  row.workshopSignups > 0 ? (row.payingNow / row.workshopSignups) * 100 : null;
                return (
                  <tr key={row.month}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {row.month}
                      {row.cohortImmature ? (
                        <span
                          className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                          title="Cohort is younger than 60 days: the 14-day trial plus a first invoice cycle has not finished, so its paid rate reads low for age reasons."
                        >
                          young
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {num(row.traffic)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {row.adSpendUsd > 0 ? sek(spendSek) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {row.adSignups > 0 ? num(row.adSignups) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-medium tabular-nums text-slate-900">
                      {costPerAdSignup !== null ? sek(costPerAdSignup) : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                      {num(row.workshopSignups)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {num(row.checkoutStarted)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {num(row.trialStarted)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">
                      {num(row.payingNow)}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right font-medium tabular-nums ${
                        row.cohortImmature ? "text-slate-400" : "text-slate-900"
                      }`}
                    >
                      {pct(paidRate)}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                      {row.workshopSignups > 0
                        ? pct((row.activated / row.workshopSignups) * 100, 0)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Traffic is GA4 new_users (ga4 active_users sums daily uniques and would
          double-count). Ad signups are campaign-scoped GA4-linked Google Ads
          sign_up events and start 2026-05-20. Signups / checkout / trial / paying
          are workshop cohorts by creation month, so &ldquo;paying&rdquo; is the state
          today, not at the time — a workshop that paid and reverted counts as
          reverted.
        </p>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Channels                                                         */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="The workbook asks for cost and paid customers across six channels. One of the six can supply both. This table is deliberately mostly empty, because that emptiness is the actual finding: per-channel CAC cannot be computed today for five of six channels."
        eyebrow="Channel economics"
        title="What we can and cannot attribute"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Attribution</th>
                <th className="py-2 pr-3 text-right">Spend</th>
                <th className="py-2 pr-3 text-right">Signups</th>
                <th className="py-2 pr-3 text-right">Cost / signup</th>
                <th className="py-2 pr-3">What is missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.channels.map((channel) => (
                <tr key={channel.key}>
                  <td className="py-2.5 pr-3 font-semibold text-slate-900">{channel.label}</td>
                  <td className="py-2.5 pr-3">
                    <AttributionPill status={channel.attribution} />
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {channel.spendSek !== null
                      ? sek((channel.spendSek / 9.6) * assumptions.sekPerUsd)
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">
                    {channel.signups !== null ? num(channel.signups) : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-medium tabular-nums text-slate-900">
                    {channel.costPerSignupSek !== null
                      ? sek((channel.costPerSignupSek / 9.6) * assumptions.sekPerUsd)
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3 text-xs leading-snug text-slate-600">
                    {channel.gap}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Churn evidence                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="Churn multiplies straight into LTV, and it is the input with the least evidence behind it. How much that matters depends entirely on the tier."
        eyebrow="The least-evidenced input"
        title="Churn evidence"
      >
        {/* Where churn actually binds. At a high gross profit per month a large
            churn rate is survivable; on a 179 kr plan it is not. Stating this
            per tier avoids the generic "churn is everything" claim, which is
            false for Small and Large at today's CAC and true for One. */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs font-semibold text-slate-700">
            How much churn each tier can survive at {sek(assumptions.cacPerSignupSek)} per
            registration
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tiers.map((tier) => {
              const ceiling = maxSurvivableChurnPct(cac, tier.grossProfitSek);
              const atRisk = ceiling <= assumptions.monthlyChurnPct * 1.5;
              return (
                <div
                  className={`rounded-lg border px-3 py-2 ${
                    atRisk ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"
                  }`}
                  key={tier.key}
                >
                  <span className="block text-[11px] font-medium text-slate-600">
                    {tier.label}
                  </span>
                  <span
                    className={`block text-sm font-semibold tabular-nums ${
                      atRisk ? "text-rose-800" : "text-emerald-800"
                    }`}
                  >
                    {pct(ceiling)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-600">
            Above its own figure, that tier never repays this CAC. Small and Large
            have room to be wrong about churn. One does not: its ceiling is{" "}
            {pct(maxSurvivableChurnPct(cac, tiers[0].grossProfitSek))}, which is
            roughly where the assumption already sits — so on One, churn is not a
            sensitivity, it is the whole question.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            hint="Subscriptions that got past their trial window"
            label="Reached paying"
            value={num(data.churn.startedPaying)}
          />
          <Stat
            hint="Of those, still subscribed"
            label="Still paying"
            value={num(data.churn.stillPaying)}
          />
          <Stat
            hint={`Over ~${data.churn.observedWindowMonths.toFixed(0)} months`}
            label="Ordinary cancellations"
            value={num(data.churn.churnedNormally)}
          />
          <Stat
            hint={`All stamped ${data.churn.bulkCancelDate} with no billing period`}
            label="Bulk-cancelled (excluded)"
            tone="warn"
            value={num(data.churn.bulkCancelled)}
          />
        </div>

        {data.churn.bulkCancelled > 0 ? (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="text-xs leading-relaxed text-amber-900">
              <strong className="font-semibold">
                Why this page does not quote a measured churn rate.
              </strong>{" "}
              {num(data.churn.bulkCancelled)} of{" "}
              {num(data.churn.bulkCancelled + data.churn.churnedNormally)} cancellations
              in <code className="rounded bg-white/70 px-1">dashboard_subscriptions</code>{" "}
              carry the same cancel date ({data.churn.bulkCancelDate}), have a NULL
              billing period, and were last updated months <em>before</em> that date.
              That is a backfill artefact, not customers leaving. Taken at face value
              it reads as {pct(data.churn.naiveMonthlyChurnPct, 0)} monthly churn and
              every LTV on this page collapses to nothing. Excluding it, the ordinary
              cancellations imply about {pct(data.churn.observedMonthlyChurnPct, 0)} —
              but on only {num(data.churn.churnedNormally)} events, which is too few to
              set a rate on. Hence a slider, not a number.
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">
              Median months paid before churning
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {data.churn.medianPaidMonthsChurned !== null
                ? `${data.churn.medianPaidMonthsChurned.toFixed(1)} mo`
                : "—"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Half of the customers who churned did so within weeks of the trial
              ending, which looks like a first-invoice failure rather than a
              considered cancellation. That is a fixable leak, not churn.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-700">
              Median months paid by customers still active
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {data.churn.medianPaidMonthsActive !== null
                ? `${data.churn.medianPaidMonthsActive.toFixed(1)} mo`
                : "—"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              Survivor-biased by construction: it only counts customers who have
              not left. Useful as a floor on the tenure of the ones who stick, not
              as a churn rate.
            </p>
          </div>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Optimisation                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="Where the leverage actually is, ranked by how much of the funnel each step loses. The CEO's second question: how do we optimise internally."
        eyebrow="How to optimise internally"
        title="Where the money leaks"
      >
        <OptimisationList
          assumptions={assumptions}
          cac={cac}
          data={data}
          grossProfitSek={headline.grossProfitSek}
        />
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Instrumentation gaps                                             */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="The CEO's note says this gets easier with separate campaigns for One and Small and all the data in one place, set up automatically. These are the specific writes that would make that true — in the order that unlocks the most of the model."
        eyebrow="To make this automatic"
        title="What to instrument"
      >
        <ol className="space-y-3">
          {INSTRUMENTATION.map((item, index) => (
            <li className="flex gap-3" key={item.title}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{item.body}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700">
                  <ArrowRight className="h-3 w-3" />
                  {item.unlocks}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {/* ---------------------------------------------------------------- */}
      {/* Provenance                                                       */}
      {/* ---------------------------------------------------------------- */}
      <Panel
        description="Every caveat that would otherwise turn into a wrong decision."
        eyebrow="Provenance"
        title="How these numbers were read"
      >
        <ul className="space-y-2">
          {data.notes.map((note) => (
            <li className="flex gap-2 text-xs leading-relaxed text-slate-600" key={note}>
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>{note}</span>
            </li>
          ))}
          <li className="flex gap-2 text-xs leading-relaxed text-slate-600">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              The CEO workbook&rsquo;s &lsquo;Economics Assumptions&rsquo; sheet has the
              formulas on rows 9 and 10 swapped against their labels: the cell
              labelled &ldquo;Monthly logo churn&rdquo; computes gross profit ÷ net ARPA,
              which is the gross margin, while &ldquo;Gross margin&rdquo; is a blank input.
              Its LTV formula on row 11 therefore only works if the churn rate is
              typed into the cell labelled &ldquo;Gross margin&rdquo;. This page derives
              margin and takes churn as the input.
            </span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Optimisation list — computed from the live funnel so the ranking moves with
// the data rather than being a static opinion.
// ---------------------------------------------------------------------------

function OptimisationList({
  data,
  assumptions,
  cac,
  grossProfitSek,
}: {
  data: CacLtvData;
  assumptions: CacLtvAssumptions;
  cac: number;
  grossProfitSek: number;
}) {
  const mature = data.months.filter(
    (row) => !row.cohortImmature && row.month >= "2026-05" && row.workshopSignups > 0,
  );
  const totals = mature.reduce(
    (acc, row) => ({
      signups: acc.signups + row.workshopSignups,
      activated: acc.activated + row.activated,
      checkout: acc.checkout + row.checkoutStarted,
      trial: acc.trial + row.trialStarted,
      paying: acc.paying + row.payingNow,
    }),
    { signups: 0, activated: 0, checkout: 0, trial: 0, paying: 0 },
  );

  if (totals.signups === 0) {
    return (
      <p className="text-sm text-slate-600">
        No mature self-serve cohort yet, so there is nothing to rank.
      </p>
    );
  }

  const rate = (numerator: number, denominator: number) =>
    denominator > 0 ? (numerator / denominator) * 100 : 0;

  // Only these three steps form a genuine chain, and it telescopes exactly:
  // (checkout/signups) x (trial/checkout) x (paying/trial) = paying/signups.
  // Activation is deliberately NOT in here. It is not a gate on purchase —
  // more workshops reach checkout than ever run a diagnostic (104 against 86 in
  // the 2026-07 cohort), so treating it as a sequential step would produce a
  // conversion rate above 100% and a meaningless uplift. It is shown below as a
  // parallel quality signal instead.
  const steps = [
    {
      label: "Signup → started checkout",
      kept: totals.checkout,
      base: totals.signups,
      lever:
        "Purchase intent. Upgrade prompts placed where value is actually felt, and a reason to need more than the free daily caps.",
    },
    {
      label: "Checkout → trial started",
      kept: totals.trial,
      base: totals.checkout,
      lever:
        "Card-entry friction. Every drop here is a workshop that reached for its card and did not finish.",
    },
    {
      label: "Trial → paying",
      kept: totals.paying,
      base: totals.trial,
      lever:
        "Trial-end conversion and first-invoice success. Half of churned customers left within weeks of trial end, which points at failed charges rather than lost interest.",
    },
  ].map((step) => {
    const keptPct = rate(step.kept, step.base);
    const lostPct = 100 - keptPct;
    // Halving this step's loss multiplies overall conversion by this factor.
    const uplift = keptPct > 0 ? (keptPct + lostPct / 2) / keptPct : 1;
    const improvedConversion = assumptions.signupToPaidPct * uplift;
    const newCac = improvedConversion > 0 ? assumptions.cacPerSignupSek / (improvedConversion / 100) : Infinity;
    return { ...step, keptPct, lostPct, uplift, newCac };
  });

  const ranked = [...steps].sort((a, b) => b.lostPct - a.lostPct);

  return (
    <div className="space-y-3">
      {ranked.map((step, index) => {
        const saving = cac - step.newCac;
        return (
          <div className="rounded-lg border border-slate-200 p-3" key={step.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                <span className="mr-1.5 text-xs font-semibold text-slate-400">
                  #{index + 1}
                </span>
                {step.label}
              </p>
              <p className="text-xs font-medium text-slate-600 tabular-nums">
                keeps {step.keptPct.toFixed(0)}% ·{" "}
                <span className="text-rose-700">loses {step.lostPct.toFixed(0)}%</span>
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rose-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(1, Math.min(100, step.keptPct))}%` }}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">{step.lever}</p>
            <p className="mt-1.5 text-[11px] font-medium text-indigo-700 tabular-nums">
              Halving this loss alone would take CAC per payer from {sek(cac)} to{" "}
              {sek(step.newCac)}
              {saving > 0 && Number.isFinite(saving)
                ? ` (${sek(saving)} cheaper per customer, break-even ${
                    breakEvenMonths(step.newCac, grossProfitSek, assumptions.monthlyChurnPct) === null
                      ? "still never"
                      : `at ${breakEvenMonths(step.newCac, grossProfitSek, assumptions.monthlyChurnPct)?.toFixed(1)} mo`
                  })`
                : ""}
              .
            </p>
          </div>
        );
      })}

      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">
            Signup → activated (ran a diagnostic)
            <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              parallel signal
            </span>
          </p>
          <p className="text-xs font-medium tabular-nums text-slate-600">
            keeps {rate(totals.activated, totals.signups).toFixed(0)}% ·{" "}
            <span className="text-rose-700">
              loses {(100 - rate(totals.activated, totals.signups)).toFixed(0)}%
            </span>
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rose-100">
          <div
            className="h-full rounded-full bg-slate-400"
            style={{
              width: `${Math.max(1, Math.min(100, rate(totals.activated, totals.signups)))}%`,
            }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          Deliberately outside the ranking above, because activation is not a gate
          on purchase: more workshops reach checkout than ever run a diagnostic, so
          it cannot be multiplied into the chain. It is still the deepest problem
          on the page — two thirds of everything paid for never uses the core
          feature once, which caps how far any downstream fix can travel and is
          the most likely reason trial conversion is where it is.
        </p>
      </div>
    </div>
  );
}

const INSTRUMENTATION: Array<{ title: string; body: string; unlocks: string }> = [
  {
    title: "Stamp first-touch source on every signup",
    body:
      "One column on the workshop (or user) row written at signup from the landing session: utm_source / utm_medium / utm_campaign, plus gclid when present. Today the only channel-attributed signup number in the warehouse is campaign-scoped ad_signups from GA4-linked Google Ads; Direct, Organic, Mail and Partner have nothing at all.",
    unlocks: "Turns five of the six channel rows from empty into measurable, and makes per-channel CAC real.",
  },
  {
    title: "Separate campaigns and landing pages for One and Small",
    body:
      "The CEO's own point, and it is the prerequisite for per-product CAC rather than per-product LTV against a blended CAC. One at 179 kr and Small at 749 kr can afford very different acquisition costs, so mixing them into one campaign hides which is actually working.",
    unlocks: "Per-product CAC, so the 4x price gap between One and Small can be spent against.",
  },
  {
    title: "Write created_by_agent at signup",
    body:
      "The column already exists on dashboard_workshops and is false on every row. Agent-sourced customers are currently indistinguishable from self-serve, and agent cost is not recorded anywhere, so the Agent channel in the workbook cannot be filled in even in principle.",
    unlocks: "The Agent channel, and a comparison of agent cost per customer against paid media.",
  },
  {
    title: "Record the premium-data supplier rate per lookup",
    body:
      "InfoPro and Motor per-vehicle cost is the largest variable cost and it exists in no table we sync. Gross margin multiplies straight into LTV, so this single unknown moves every LTV figure on this page. Observed consumption is already measured (Small ~4 vehicles/month against a 20 allowance), so only the unit rate is missing.",
    unlocks: "A gross margin that is measured rather than assumed, and therefore an LTV that is too.",
  },
  {
    title: "Keep a subscription state history",
    body:
      "Only the current plan is stored, so churn has to be reconstructed from Stripe fingerprints and cancel timestamps — which is how a backfill of same-day cancel dates ends up looking like a mass exodus. An append-only row per subscription state change makes cohort retention and true logo churn a query rather than a guess.",
    unlocks: "Measured monthly churn, which is the input this whole model is most sensitive to.",
  },
  {
    title: "Separate trial-end failure from real cancellation",
    body:
      "Half of the customers who churned did so within weeks of trial end. Whether that is a failed first charge or a deliberate cancellation changes the fix completely — dunning and card retry versus product value — and today the data cannot tell them apart.",
    unlocks: "Knowing whether the biggest leak is a payments problem or a product problem.",
  },
];
