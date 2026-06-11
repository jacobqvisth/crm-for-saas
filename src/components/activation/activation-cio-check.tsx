"use client";

import { useEffect, useState } from "react";
import { Check, CheckCheck, Download, Link2, Loader2, X } from "lucide-react";
import type { ActivationItem } from "@/lib/activation/types";
import type { CioCampaignSummary } from "@/lib/activation/cio";
import type { VerifyFinding } from "@/app/api/activation/cio/verify/route";
import { statusStyle } from "@/lib/activation/status";

// Results of the "Check Customer.io" reconciliation: wrong statuses to fix,
// unlinked touchpoints with a suggested campaign, touchpoints with no
// counterpart, and campaigns that exist in Customer.io but not on the board.
// All fixes are applied through the normal item CRUD via the parent.

interface CioCheckModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  findings: VerifyFinding[];
  importable: CioCampaignSummary[];
  onClose: () => void;
  /** Apply a correction/link to an existing touchpoint. */
  onApply: (itemId: string, patch: Partial<ActivationItem>) => void;
  /** Create a touchpoint from an unmatched Customer.io campaign. */
  onImport: (campaign: CioCampaignSummary) => Promise<boolean>;
}

function patchFor(f: VerifyFinding): Partial<ActivationItem> {
  const patch: Partial<ActivationItem> = {};
  if (f.verdict === "unlinked_match" && f.campaign) patch.cio_campaign_id = String(f.campaign.id);
  if (f.suggested_status) patch.status = f.suggested_status;
  if (f.suggested_note) patch.source_note = f.suggested_note;
  return patch;
}

export function CioCheckModal({
  open,
  loading,
  error,
  findings,
  importable,
  onClose,
  onApply,
  onImport,
}: CioCheckModalProps) {
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setDone(new Set());
  }, [open]);

  if (!open) return null;

  const mismatches = findings.filter((f) => f.verdict === "state_mismatch");
  const suggestions = findings.filter((f) => f.verdict === "unlinked_match");
  const missing = findings.filter(
    (f) => f.verdict === "no_match" || f.verdict === "linked_missing"
  );
  const ok = findings.filter((f) => f.verdict === "ok");
  const actionable = [...mismatches, ...suggestions].filter((f) => !done.has(f.item_id));

  const markDone = (key: string) => setDone((d) => new Set(d).add(key));

  function applyFinding(f: VerifyFinding) {
    onApply(f.item_id, patchFor(f));
    markDone(f.item_id);
  }

  const statusPill = (status: string | null) => {
    const st = statusStyle(status);
    return st ? (
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.pill}`}>{st.label}</span>
    ) : (
      <span className="text-[11px] text-slate-400">—</span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative mx-auto my-[6vh] w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Customer.io check</h2>
          {!loading && !error && (
            <span className="text-xs text-slate-400">
              {ok.length} in sync · {mismatches.length + suggestions.length} fixable ·{" "}
              {importable.length} not on the board
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Comparing the board against live
            Customer.io campaigns…
          </p>
        ) : error ? (
          <p className="py-6 text-sm text-amber-600">{error}</p>
        ) : (
          <div className="space-y-5">
            {actionable.length > 1 && (
              <button
                onClick={() => actionable.forEach(applyFinding)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <CheckCheck className="h-4 w-4" /> Apply all {actionable.length} fixes
              </button>
            )}

            {mismatches.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Wrong status — campaign state says otherwise
                </h3>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {mismatches.map((f) => (
                    <div key={f.item_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{f.item_title}</span>
                      {statusPill(f.item_status)}
                      <span className="text-slate-300">→</span>
                      {statusPill(f.suggested_status)}
                      <span className="hidden truncate text-xs text-slate-400 sm:inline">
                        “{f.campaign?.name}” is {f.campaign?.state}
                      </span>
                      {done.has(f.item_id) ? (
                        <Check className="h-4 w-4 shrink-0 text-green-500" />
                      ) : (
                        <button
                          onClick={() => applyFinding(f)}
                          className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Fix
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {suggestions.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Unlinked — likely matching campaign found
                </h3>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {suggestions.map((f) => (
                    <div key={f.item_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{f.item_title}</span>
                      <span className="truncate text-xs text-slate-500">
                        “{f.campaign?.name}” · {f.campaign?.state}
                        {f.score != null && (
                          <span className="text-slate-300"> · {Math.round(f.score * 100)}%</span>
                        )}
                      </span>
                      {done.has(f.item_id) ? (
                        <Check className="h-4 w-4 shrink-0 text-green-500" />
                      ) : (
                        <button
                          onClick={() => applyFinding(f)}
                          className="flex shrink-0 items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          <Link2 className="h-3 w-3" /> Link + fix status
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {importable.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  In Customer.io but not on the board
                </h3>
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {importable.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{c.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {c.state ?? "unknown"}
                      </span>
                      {done.has(`import-${c.id}`) ? (
                        <Check className="h-4 w-4 shrink-0 text-green-500" />
                      ) : (
                        <button
                          onClick={async () => {
                            if (await onImport(c)) markDone(`import-${c.id}`);
                          }}
                          className="flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          <Download className="h-3 w-3" /> Add to board
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Imported touchpoints land on day 0 — open them to set the right day.
                </p>
              </section>
            )}

            {missing.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  No counterpart in Customer.io
                </h3>
                <div className="rounded-lg border border-slate-200 px-3 py-2">
                  {missing.map((f) => (
                    <p key={f.item_id} className="flex items-center gap-2 py-0.5 text-sm text-slate-600">
                      <span className="min-w-0 flex-1 truncate">{f.item_title}</span>
                      {statusPill(f.item_status)}
                      <span className="text-xs text-slate-400">
                        {f.verdict === "linked_missing" ? "linked campaign deleted" : "no match — likely a genuine gap"}
                      </span>
                    </p>
                  ))}
                </div>
              </section>
            )}

            {mismatches.length + suggestions.length + importable.length + missing.length === 0 && (
              <p className="py-4 text-sm text-slate-500">
                Everything on the board matches Customer.io. Nothing to fix.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
