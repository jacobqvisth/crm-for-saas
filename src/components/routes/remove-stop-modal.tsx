"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

export const REMOVE_REASONS = [
  "route_too_long",
  "recent_contact",
  "wrong_location",
  "not_icp",
  "permanently_closed",
  "other",
] as const;
export type RemoveReason = (typeof REMOVE_REASONS)[number];

const LABEL: Record<RemoveReason, string> = {
  route_too_long: "Route too long — just trimming",
  recent_contact: "Already in contact recently",
  wrong_location: "Wrong location / outside our area",
  not_icp: "Not ICP / wrong business type",
  permanently_closed: "Permanently closed",
  other: "Other",
};

const HINT: Record<RemoveReason, string> = {
  route_too_long: "Just removing this stop. Doesn't flag the shop globally.",
  recent_contact: "Just removing this stop. Doesn't flag the shop globally.",
  wrong_location: "Flags the shop so future routes skip it.",
  not_icp: "Flags the shop so future routes skip it.",
  permanently_closed: "Flags the shop AND marks it permanently closed.",
  other: "Just removing this stop. Notes are required.",
};

type Props = {
  state: { stopId: string; shopName: string } | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reason: RemoveReason, notes: string | undefined) => void;
};

export default function RemoveStopModal({ state, submitting, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<RemoveReason>("route_too_long");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (state) {
      setReason("route_too_long");
      setNotes("");
    }
  }, [state]);

  if (!state) return null;

  const requiresNotes = reason === "other";
  const canSubmit = !submitting && (!requiresNotes || notes.trim().length > 0);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40">
      <div
        className="bg-white border border-slate-200 rounded-t-xl sm:rounded-xl w-full sm:max-w-md p-5 space-y-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Remove stop</h2>
            <p className="text-xs text-slate-500 truncate">{state.shopName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-slate-700 mb-1">Why are you removing this stop?</legend>
          {REMOVE_REASONS.map((r) => (
            <label
              key={r}
              className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer transition-colors ${
                reason === r ? "border-indigo-200 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="remove-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-slate-800">{LABEL[r]}</span>
                <span className="block text-slate-500 mt-0.5">{HINT[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Notes {requiresNotes && <span className="text-red-600">*</span>}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={requiresNotes ? "Required for 'other'" : "Optional"}
            className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reason, notes.trim() || undefined)}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Remove stop
          </button>
        </div>
      </div>
    </div>
  );
}
