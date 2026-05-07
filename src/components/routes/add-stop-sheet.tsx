"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Search, Sparkles } from "lucide-react";

export type AddStopSheetState = { open: boolean };

type Suggestion = {
  kind: "discovered_shop" | "company";
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mode: "cold" | "lapsed";
  distanceKm?: number;
  lastVisitedAt?: string;
};

type SearchResult = {
  kind: "discovered_shop" | "company";
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mode: "cold" | "lapsed";
};

type Tab = "suggested" | "search";

type Props = {
  state: AddStopSheetState | null;
  routeId: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: { discoveredShopId?: string; companyId?: string }) => void;
};

export default function AddStopSheet({ state, routeId, submitting, onClose, onSubmit }: Props) {
  const [tab, setTab] = useState<Tab>("suggested");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!state?.open) return;
    setTab("suggested");
    setQuery("");
    setResults([]);
    setLoadingSuggested(true);
    fetch(`/api/routes/${routeId}/suggestions?limit=10`)
      .then((r) => r.json())
      .then((data: { suggestions?: Suggestion[] }) => {
        setSuggestions(data.suggestions ?? []);
      })
      .catch(() => setSuggestions([]))
      .finally(() => setLoadingSuggested(false));
  }, [state, routeId]);

  // Debounced search.
  useEffect(() => {
    if (tab !== "search") return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      fetch(`/api/routes/${routeId}/stop-search?q=${encodeURIComponent(q)}&limit=10`)
        .then((r) => r.json())
        .then((data: { results?: SearchResult[] }) => setResults(data.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, tab, routeId]);

  if (!state?.open) return null;

  function pickResult(r: { kind: "discovered_shop" | "company"; id: string }) {
    if (submitting) return;
    if (r.kind === "company") onSubmit({ companyId: r.id });
    else onSubmit({ discoveredShopId: r.id });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-slate-900/40">
      <div
        className="bg-white border border-slate-200 rounded-t-xl sm:rounded-xl w-full sm:max-w-lg p-5 max-h-[85vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add stop</h2>
            <p className="text-xs text-slate-500">Pick a nearby ICP shop or search by name.</p>
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

        <div className="flex items-center gap-1 mb-3 text-xs">
          <button
            type="button"
            onClick={() => setTab("suggested")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors ${
              tab === "suggested"
                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Suggested
          </button>
          <button
            type="button"
            onClick={() => setTab("search")}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-colors ${
              tab === "search"
                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>
        </div>

        {tab === "search" && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            autoFocus
            className="w-full px-3 py-2 mb-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        )}

        <div className="overflow-y-auto -mx-1 px-1">
          {tab === "suggested" ? (
            loadingSuggested ? (
              <div className="flex items-center justify-center py-10 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : suggestions.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                No nearby suggestions right now.
              </p>
            ) : (
              <ul className="space-y-1">
                {suggestions.map((s) => (
                  <ResultRow
                    key={`${s.kind}-${s.id}`}
                    name={s.name}
                    address={s.address}
                    mode={s.mode}
                    distanceKm={s.distanceKm}
                    lastVisitedAt={s.lastVisitedAt}
                    disabled={submitting}
                    onPick={() => pickResult(s)}
                  />
                ))}
              </ul>
            )
          ) : query.trim().length < 2 ? (
            <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters.</p>
          ) : searching ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No matches.</p>
          ) : (
            <ul className="space-y-1">
              {results.map((r) => (
                <ResultRow
                  key={`${r.kind}-${r.id}`}
                  name={r.name}
                  address={r.address}
                  mode={r.mode}
                  disabled={submitting}
                  onPick={() => pickResult(r)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  name,
  address,
  mode,
  distanceKm,
  lastVisitedAt,
  disabled,
  onPick,
}: {
  name: string;
  address: string;
  mode: "cold" | "lapsed";
  distanceKm?: number;
  lastVisitedAt?: string;
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <li className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center gap-3 hover:border-indigo-200">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-800 truncate">{name}</span>
          <span
            className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border ${
              mode === "lapsed"
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-sky-50 text-sky-700 border-sky-200"
            }`}
          >
            {mode}
          </span>
        </div>
        <div className="text-xs text-slate-500 truncate">{address}</div>
        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
          {typeof distanceKm === "number" && <span>{distanceKm.toFixed(1)} km away</span>}
          {lastVisitedAt && (
            <span>· last visit {new Date(lastVisitedAt).toLocaleDateString()}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex-shrink-0"
      >
        Add →
      </button>
    </li>
  );
}
