"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { VISIT_OUTCOMES, type VisitOutcome } from "@/lib/routes/visits-decision";
import { OUTCOME_OPTIONS } from "@/lib/activities/outcomes";

const AUTO_ENROLL_DEFAULT: Record<VisitOutcome, boolean> = {
  interested: true,
  not_interested: false,
  closed: false,
  no_answer: true,
  skipped: false,
};

export type MarkVisitedSheetState = {
  stopId: string;
  shopName: string;
  initialOutcome?: VisitOutcome;
  initialNotes?: string;
};

type Props = {
  state: MarkVisitedSheetState | null;
  configuredOutcomes: Set<VisitOutcome>;
  workspaceAutoEnabled: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    outcome: VisitOutcome;
    notes?: string;
    enrollOverride?: boolean;
  }) => Promise<void>;
};

export default function MarkVisitedSheet({
  state,
  configuredOutcomes,
  workspaceAutoEnabled,
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const [outcome, setOutcome] = useState<VisitOutcome>("interested");
  const [notes, setNotes] = useState("");
  const [enrollChecked, setEnrollChecked] = useState(true);

  useEffect(() => {
    if (state) {
      setOutcome(state.initialOutcome ?? "interested");
      setNotes(state.initialNotes ?? "");
      setEnrollChecked(AUTO_ENROLL_DEFAULT[state.initialOutcome ?? "interested"]);
    }
  }, [state]);

  useEffect(() => {
    setEnrollChecked(AUTO_ENROLL_DEFAULT[outcome]);
  }, [outcome]);

  if (!state) return null;

  const sequenceConfigured = configuredOutcomes.has(outcome);
  const showEnrollCheckbox = AUTO_ENROLL_DEFAULT[outcome] && workspaceAutoEnabled && sequenceConfigured;

  async function handleSubmit() {
    if (!state) return;
    const input: { outcome: VisitOutcome; notes?: string; enrollOverride?: boolean } = {
      outcome,
    };
    if (notes.trim().length > 0) input.notes = notes.trim();
    if (showEnrollCheckbox && !enrollChecked) input.enrollOverride = false;
    await onSubmit(input);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl shadow-xl flex flex-col max-h-[90vh] sm:max-h-[80vh] rounded-t-2xl sm:rounded-b-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Mark visited</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[280px]">{state.shopName}</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-2 -m-2 text-slate-400 hover:text-slate-700 disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <fieldset>
            <legend className="text-xs font-medium text-slate-700 mb-2">Outcome</legend>
            <div className="space-y-2">
              {OUTCOME_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer min-h-[44px] ${
                    outcome === opt.value
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="outcome"
                    value={opt.value}
                    checked={outcome === opt.value}
                    onChange={() => setOutcome(opt.value)}
                    className="mt-1 accent-indigo-600"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{opt.label}</div>
                    <div className="text-xs text-slate-500">{opt.helper}</div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              rows={3}
              autoFocus={false}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Anything Hans noted on site…"
            />
            <p className="text-[10px] text-slate-400 mt-1 text-right">{notes.length}/500</p>
          </div>

          {AUTO_ENROLL_DEFAULT[outcome] && (
            workspaceAutoEnabled && sequenceConfigured ? (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enrollChecked}
                  onChange={(e) => setEnrollChecked(e.target.checked)}
                  className="mt-1 accent-indigo-600"
                />
                <span className="text-sm text-slate-700">
                  Auto-enroll the company&apos;s primary contact in the follow-up sequence
                </span>
              </label>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {workspaceAutoEnabled
                  ? "No auto-enroll sequence configured for this outcome — visit will be logged but no email goes out."
                  : "Auto-enroll is disabled workspace-wide."}
              </p>
            )
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-slate-700 rounded-lg hover:bg-slate-100 disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 min-h-[44px]"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? "Saving…" : "Log visit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { VISIT_OUTCOMES };
