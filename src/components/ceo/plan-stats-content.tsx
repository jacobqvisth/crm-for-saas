"use client";

import { useMemo, useState } from "react";
import { compactNumber, formatNumber } from "@/lib/ceo/format";
import {
  PLAN_DEFINITIONS,
  type PlanBullet,
  type PlanDefinition,
  type PlanFeatureStat,
  type PlanStatRow,
  type PlanStatsData,
  type PlanTier,
} from "@/lib/ceo/plan-stats-shared";
import { InfoHint, type SourceInfo } from "./source-info";

type PlanStatsContentProps = {
  data: PlanStatsData;
};

const PLAN_INFO: SourceInfo = {
  title: "Plan membership",
  body:
    "Each user is mapped to a plan via their workshop's plan_key on dashboard_workshops (synced hourly from Stripe). The four tiers mirror the public pricing page; users with no plan are excluded.",
  sources: ["Stripe → dashboard_workshops.plan_key", "dashboard_users.workshop_id"],
  logic:
    "plan_key values like small_monthly / large_yearly collapse to their tier (Free / One / Small / Large). 'Users' counts the whole base on a plan; 'Active' counts those with a login in the range.",
};

const FEATURE_INFO: SourceInfo = {
  title: "Feature counters per plan",
  body:
    "Per-user, per-day feature activity (diagnostics, chat, AI search, VRM lookups, InfoPro, Motor) summed across every user on the plan.",
  sources: ["codeoc S3 export · user_stats counters", "dashboard_feature_usage"],
  logic:
    "Counters exist from 2026-06-11 onward — earlier days are zero by construction. Badges on a feature row show that plan's total events for the matching counter(s).",
};

function CheckIcon({ muted = false }: { muted?: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
        muted ? "bg-slate-100 text-slate-300" : "bg-blue-50 text-blue-600"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none">
        <path
          d="M3.5 8.5l2.5 2.5 6-6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// Sum of events across the feature counter(s) backing a "metric" bullet.
function bulletMetric(
  bullet: PlanBullet,
  featureByKey: Map<string, PlanFeatureStat>,
): { events: number; users: number } {
  let events = 0;
  let users = 0;
  for (const key of bullet.features ?? []) {
    const stat = featureByKey.get(key);
    if (stat) {
      events += stat.events;
      users = Math.max(users, stat.users);
    }
  }
  return { events, users };
}

function PlanCard({
  definition,
  row,
}: {
  definition: PlanDefinition;
  row: PlanStatRow;
}) {
  const [expanded, setExpanded] = useState(false);
  const featureByKey = useMemo(
    () => new Map(row.features.map((f) => [f.key, f])),
    [row.features],
  );
  const popular = Boolean(definition.popular);

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
        popular ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200"
      }`}
    >
      {popular ? (
        <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          Most popular
        </span>
      ) : null}

      <div>
        <h3 className="text-lg font-semibold text-slate-900">{definition.name}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{definition.tagline}</p>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">
          ${definition.monthlyPrice}
        </span>
        <span className="text-sm text-slate-500">/ month</span>
      </div>
      {definition.yearlySave ? (
        <span className="mt-2 inline-flex w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          {definition.yearlySave}
        </span>
      ) : null}

      {/* Plan headline stats */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
        <div>
          <div className="text-lg font-semibold text-slate-900">
            {formatNumber(row.users)}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Users
          </div>
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-900">
            {formatNumber(row.activeUsers)}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Active
          </div>
        </div>
        <div>
          <div className="text-lg font-semibold text-slate-900">
            {compactNumber(row.featureEvents)}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Events
          </div>
        </div>
      </div>

      {/* Feature bullets with inline stat badges */}
      <ul className="mt-4 flex flex-col gap-2.5 text-sm">
        {definition.bullets.map((bullet, index) => {
          const locked = bullet.kind === "locked";
          let badge: string | null = null;
          let badgeTitle: string | undefined;
          if (bullet.kind === "metric") {
            const { events, users } = bulletMetric(bullet, featureByKey);
            badge = compactNumber(events);
            badgeTitle = `${formatNumber(events)} events · ${formatNumber(users)} users`;
          } else if (bullet.kind === "seats") {
            badge = formatNumber(row.users);
            badgeTitle = `${formatNumber(row.users)} users on this plan`;
          }
          return (
            <li
              key={`${bullet.label}-${index}`}
              className="flex items-start justify-between gap-2"
            >
              <span className="flex items-start gap-2">
                <CheckIcon muted={locked} />
                <span className={locked ? "text-slate-400" : "text-slate-700"}>
                  {bullet.label}
                </span>
              </span>
              {badge !== null ? (
                <span
                  title={badgeTitle}
                  className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-blue-700"
                >
                  {badge}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Expandable per-feature drill-down */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        aria-expanded={expanded}
      >
        {expanded ? "Hide feature detail" : "Show feature detail"}
        <span aria-hidden>{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Feature</th>
                <th className="px-2 py-1.5 text-right font-medium">Events</th>
                <th className="px-2 py-1.5 text-right font-medium">Users</th>
                <th className="px-2 py-1.5 text-right font-medium">Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {row.features.map((feature) => (
                <tr key={feature.key} className="text-slate-700">
                  <td className="px-2 py-1.5" title={feature.description}>
                    {feature.label}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(feature.events)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatNumber(feature.users)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                    {feature.avgPerUser > 0
                      ? feature.avgPerUser.toFixed(1)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 text-center text-[11px] text-slate-400">
        {formatNumber(row.workshops)} workshop{row.workshops === 1 ? "" : "s"} ·{" "}
        {formatNumber(row.logins)} logins
      </div>
    </div>
  );
}

export function PlanStatsContent({ data }: PlanStatsContentProps) {
  const rowByTier = useMemo(
    () => new Map<PlanTier, PlanStatRow>(data.plans.map((p) => [p.tier, p])),
    [data.plans],
  );

  return (
    <div className="space-y-5">
      {/* Overview KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">
            Users on a plan <InfoHint info={PLAN_INFO} />
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {formatNumber(data.totals.users)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Active in range
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {formatNumber(data.totals.activeUsers)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">
            Feature events <InfoHint info={FEATURE_INFO} />
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {formatNumber(data.totals.featureEvents)}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {data.rangeLabel} · {data.rangeSpan}. {data.note}
      </p>

      {/* Pricing cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLAN_DEFINITIONS.map((definition) => {
          const row =
            rowByTier.get(definition.tier) ??
            ({
              tier: definition.tier,
              users: 0,
              workshops: 0,
              activeUsers: 0,
              logins: 0,
              featureEvents: 0,
              features: [],
            } as PlanStatRow);
          return (
            <PlanCard key={definition.tier} definition={definition} row={row} />
          );
        })}
      </div>
    </div>
  );
}
