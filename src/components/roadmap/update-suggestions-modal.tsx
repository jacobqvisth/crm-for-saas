"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { statusStyle } from "@/lib/roadmap/colors";
import type { SuggestionOut } from "@/app/api/roadmap/suggest-updates/route";

export interface AppliedUpdate {
  id: string;
  status: string;
  progress_note: string;
}

interface Props {
  open: boolean;
  loading: boolean;
  suggestions: SuggestionOut[];
  onClose: () => void;
  onApply: (updates: AppliedUpdate[]) => void;
}

type Row = { checked: boolean; status: string; note: string };

const CONF_CHIP: Record<string, string> = {
  high: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-500",
};

function StatusPill({ status }: { status: string | null }) {
  const s = statusStyle(status);
  if (!s) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function UpdateSuggestionsModal({ open, loading, suggestions, onClose, onApply }: Props) {
  const [rows, setRows] = useState<Record<string, Row>>({});

  useEffect(() => {
    const next: Record<string, Row> = {};
    for (const s of suggestions) {
      const changed = s.suggested_status !== (s.current_status ?? "");
      next[s.id] = {
        // Pre-check confident, meaningful suggestions; leave low-confidence/no-ops off.
        checked: s.confidence !== "low" && (changed || !!s.progress_note),
        status: s.suggested_status,
        note: s.progress_note,
      };
    }
    setRows(next);
  }, [suggestions]);

  const grouped = useMemo(() => {
    const m = new Map<string, SuggestionOut[]>();
    for (const s of suggestions) {
      const arr = m.get(s.group) ?? [];
      arr.push(s);
      m.set(s.group, arr);
    }
    return [...m.entries()];
  }, [suggestions]);

  const selectedCount = Object.values(rows).filter((r) => r.checked).length;

  if (!open) return null;

  function applyNow() {
    const updates: AppliedUpdate[] = suggestions
      .filter((s) => rows[s.id]?.checked)
      .map((s) => ({ id: s.id, status: rows[s.id].status, progress_note: rows[s.id].note }));
    onApply(updates);
  }

  function setAll(checked: boolean) {
    setRows((prev) => {
      const next: Record<string, Row> = {};
      for (const [id, r] of Object.entries(prev)) next[id] = { ...r, checked };
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <Sparkles className="h-5 w-5 text-indigo-500" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">Suggested progress updates</h2>
            <p className="text-xs text-slate-500">
              Inferred from your internal CRM data — reviews, outreach, ads, app activation.
            </p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
              Analyzing what&apos;s actually been done…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">No suggestions — nothing to update.</div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-3 text-xs">
                <button onClick={() => setAll(true)} className="text-indigo-600 hover:underline">Select all</button>
                <button onClick={() => setAll(false)} className="text-slate-500 hover:underline">Clear</button>
                <span className="ml-auto text-slate-400">{selectedCount} selected</span>
              </div>
              <div className="space-y-5">
                {grouped.map(([group, list]) => (
                  <div key={group}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
                    <div className="space-y-2">
                      {list.map((s) => {
                        const r = rows[s.id];
                        if (!r) return null;
                        return (
                          <div
                            key={s.id}
                            className={`rounded-lg border p-3 ${r.checked ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"}`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={r.checked}
                                onChange={(e) =>
                                  setRows((prev) => ({ ...prev, [s.id]: { ...prev[s.id], checked: e.target.checked } }))
                                }
                                className="mt-1 h-4 w-4 accent-indigo-600"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-slate-800">{s.title}</span>
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CONF_CHIP[s.confidence]}`}>
                                    {s.confidence}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <StatusPill status={s.current_status} />
                                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                                  <select
                                    value={r.status}
                                    onChange={(e) =>
                                      setRows((prev) => ({ ...prev, [s.id]: { ...prev[s.id], status: e.target.value } }))
                                    }
                                    className="rounded border border-slate-200 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  >
                                    {["Not started", "In progress", "Done", "Blocked"].map((st) => (
                                      <option key={st} value={st}>{st}</option>
                                    ))}
                                  </select>
                                </div>
                                <input
                                  value={r.note}
                                  onChange={(e) =>
                                    setRows((prev) => ({ ...prev, [s.id]: { ...prev[s.id], note: e.target.value } }))
                                  }
                                  placeholder="Progress note"
                                  className="mt-2 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
            Cancel
          </button>
          <button
            onClick={applyNow}
            disabled={loading || selectedCount === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Apply {selectedCount > 0 ? selectedCount : ""} {selectedCount === 1 ? "update" : "updates"}
          </button>
        </div>
      </div>
    </div>
  );
}
