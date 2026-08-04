"use client";

// Where the facts come from. Three modes:
//
//   diagnostic  one real diagnostic our engine ran, richest first
//   stats       an aggregate stat story over our DTC / search-term analysis
//   free_topic  nothing, so the model may state no figures at all
//
// The stats mode is the interesting one: rather than handing the model a pile of
// numbers, each story is one pre-framed angle over one slice of the analysis. A
// story whose sample is too thin is shown but disabled, so a piece can never be
// published off four data points.

import { BarChart3, Car, Loader2, PenLine, Lock } from "lucide-react";
import type { DiagnosticCandidate } from "@/lib/articles/sources";
import type { StatStoryAvailability } from "@/lib/articles/stat-stories";
import type { ArticleSourceKind } from "@/lib/articles/types";

export interface SourceTotals {
  diagnostics: number;
  withCodes: number;
  described: number;
  distinctCodes: number;
}

type Props = {
  kind: ArticleSourceKind;
  onKindChange: (kind: ArticleSourceKind) => void;

  diagnostics: DiagnosticCandidate[];
  statStories: StatStoryAvailability[];
  totals: SourceTotals | null;
  loading: boolean;

  selectedDiagnosticId: string | null;
  onSelectDiagnostic: (id: string) => void;
  selectedStatStory: string | null;
  onSelectStatStory: (key: string) => void;
  freeTopic: string;
  onFreeTopicChange: (value: string) => void;

  search: string;
  onSearchChange: (value: string) => void;
};

const KINDS: Array<{ key: ArticleSourceKind; label: string; icon: typeof Car; hint: string }> = [
  {
    key: "diagnostic",
    label: "A real diagnostic",
    icon: Car,
    hint: "One actual case: the vehicle, the codes, the ranked causes",
  },
  {
    key: "stats",
    label: "Our data",
    icon: BarChart3,
    hint: "An insight drawn from all our diagnostics and fault-code stats",
  },
  {
    key: "free_topic",
    label: "Just a topic",
    icon: PenLine,
    hint: "No data behind it, so no figures allowed",
  },
];

export function SourcePicker(props: Props) {
  const {
    kind,
    onKindChange,
    diagnostics,
    statStories,
    totals,
    loading,
    selectedDiagnosticId,
    onSelectDiagnostic,
    selectedStatStory,
    onSelectStatStory,
    freeTopic,
    onFreeTopicChange,
    search,
    onSearchChange,
  } = props;

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? diagnostics.filter((d) =>
        [d.car, d.description ?? "", d.dtcs.join(" "), d.topCauseName ?? "", d.country ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : diagnostics;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">1. What is this based on?</h2>
        {totals && (
          <span className="text-xs text-slate-400">
            {totals.diagnostics.toLocaleString()} diagnostics, {totals.distinctCodes} distinct fault
            codes
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const active = kind === k.key;
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => onKindChange(k.key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <span
                className={`flex items-center gap-2 text-sm font-medium ${
                  active ? "text-indigo-700" : "text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {k.label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-slate-500">{k.hint}</span>
            </button>
          );
        })}
      </div>

      {loading && kind !== "free_topic" && (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading from the diagnostics history…
        </p>
      )}

      {/* --- Real diagnostic --------------------------------------------- */}
      {kind === "diagnostic" && !loading && (
        <div className="mt-4">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by car, fault code, symptom…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">No diagnostics match that.</p>
            )}
            {filtered.map((d) => {
              const active = selectedDiagnosticId === d.diagnosticId;
              return (
                <button
                  key={d.diagnosticId}
                  type="button"
                  onClick={() => onSelectDiagnostic(d.diagnosticId)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{d.car}</span>
                    {d.dtcs.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
                      >
                        {c}
                      </span>
                    ))}
                    {d.country && <span className="text-[11px] text-slate-400">{d.country}</span>}
                  </div>
                  {d.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">
                      {d.description}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {d.causeCount} ranked {d.causeCount === 1 ? "cause" : "causes"}
                    {d.testCount > 0 && `, ${d.testCount} suggested tests`}
                    {d.topCauseName && `, top: ${d.topCauseName}`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* --- Stat story --------------------------------------------------- */}
      {kind === "stats" && !loading && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-500">
            Each of these is one angle over our real numbers. The facts get handed to the model with
            their definitions and sample sizes attached, so it argues a point instead of reading out
            a table.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {statStories.map((s) => {
              const active = selectedStatStory === s.key;
              const disabled = !s.available;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectStatStory(s.key)}
                  title={
                    disabled
                      ? `Needs at least ${s.minSample} ${s.sampleLabel}, we have ${s.sample}`
                      : undefined
                  }
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    disabled
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                      : active
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span
                    className={`flex items-center gap-1.5 text-sm font-medium ${
                      active ? "text-indigo-700" : "text-slate-800"
                    }`}
                  >
                    {disabled && <Lock className="h-3 w-3 shrink-0 text-slate-400" />}
                    {s.label}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-slate-500">{s.blurb}</span>
                  <span className="mt-1.5 block text-[11px] text-slate-400">
                    {disabled
                      ? `Needs ${s.minSample} ${s.sampleLabel}, have ${s.sample}`
                      : `${s.sample.toLocaleString()} ${s.sampleLabel}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* --- Free topic --------------------------------------------------- */}
      {kind === "free_topic" && (
        <div className="mt-4">
          <textarea
            value={freeTopic}
            onChange={(e) => onFreeTopicChange(e.target.value)}
            rows={3}
            placeholder="What should this be about?"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <p className="mt-1.5 text-xs text-amber-700">
            With no data behind it the model is not allowed to state any statistic, and everything it
            asserts will be flagged as unsourced for you to check.
          </p>
        </div>
      )}
    </section>
  );
}
