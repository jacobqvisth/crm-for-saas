"use client";

// Business impact figures, typed by a human.
//
// This form exists because of a specific failure mode. The competitor LinkedIn
// post that prompted this feature closes with "2 hours saved, a 6-day delay
// eliminated, $750 in revenue unlocked, $315 in additional profit". We hold no
// per-ticket financial outcome data at all, so a model asked to write in that
// shape will invent those numbers about a real case. Anything left blank here is
// simply absent from the draft, and the model is told in the prompt that it may
// not estimate them.

import { AlertTriangle, Info } from "lucide-react";
import type { ArticleImpact } from "@/lib/articles/types";

type Props = {
  value: ArticleImpact;
  onChange: (next: ArticleImpact) => void;
};

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function Field(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string | null;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{props.label}</span>
      <div className="mt-1 flex items-center rounded-lg border border-slate-200 focus-within:border-indigo-400">
        {props.prefix && (
          <span className="pl-2.5 text-xs text-slate-400">{props.prefix}</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={props.value ?? ""}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(numberOrNull(e.target.value))}
          className="w-full bg-transparent px-2.5 py-1.5 text-sm outline-none"
        />
      </div>
    </label>
  );
}

export function ImpactForm({ value, onChange }: Props) {
  const set = (patch: Partial<ArticleImpact>) => onChange({ ...value, ...patch });
  // A money amount with no currency chosen cannot be rendered with a unit, so
  // warn at the point of the decision rather than letting it surface in the draft.
  const needsCurrency =
    (value.ticketValue != null || value.additionalProfit != null) && !value.currency?.trim();

  return (
    <div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>
          Optional, and only fill in what you actually know. We hold no revenue or labour-hour data
          per job, so anything left blank simply will not appear. The model is not allowed to guess
          these.
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Hours saved"
          value={value.hoursSaved}
          onChange={(hoursSaved) => set({ hoursSaved })}
          placeholder="e.g. 2"
        />
        <Field
          label="Days of delay avoided"
          value={value.daysAvoided}
          onChange={(daysAvoided) => set({ daysAvoided })}
          placeholder="e.g. 6"
        />
        {/* No fallback "$" here. Showing a currency the user has not chosen
            implies the draft will say dollars, which it will not. */}
        <Field
          label="Ticket value"
          value={value.ticketValue}
          onChange={(ticketValue) => set({ ticketValue })}
          prefix={value.currency?.trim() || null}
          placeholder="e.g. 750"
        />
        <Field
          label="Additional profit"
          value={value.additionalProfit}
          onChange={(additionalProfit) => set({ additionalProfit })}
          prefix={value.currency?.trim() || null}
          placeholder="e.g. 315"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Currency</span>
          <select
            value={value.currency ?? ""}
            onChange={(e) => set({ currency: e.target.value || null })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">Not set</option>
            <option value="$">USD ($)</option>
            <option value="€">EUR (€)</option>
            <option value="SEK ">SEK</option>
            <option value="£">GBP (£)</option>
          </select>
          {needsCurrency && (
            <span className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Pick one, or the draft has to write the amount without any currency at all.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">Escalation</span>
          <select
            value={
              value.resolvedWithoutEscalation === null
                ? ""
                : value.resolvedWithoutEscalation
                  ? "yes"
                  : "no"
            }
            onChange={(e) =>
              set({
                resolvedWithoutEscalation:
                  e.target.value === "" ? null : e.target.value === "yes",
              })
            }
            className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
          >
            <option value="">Not stated</option>
            <option value="yes">Resolved without a senior tech</option>
            <option value="no">Needed a senior tech</option>
          </select>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-slate-500">
          Anything else you can state as fact
        </span>
        <input
          value={value.note ?? ""}
          onChange={(e) => set({ note: e.target.value || null })}
          placeholder="e.g. the shop had already replaced two parts before this"
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
        />
      </label>
    </div>
  );
}
