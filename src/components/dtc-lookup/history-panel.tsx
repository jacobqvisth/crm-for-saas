"use client";

import { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { History, Trash2, GitCompare, Search, FileText } from "lucide-react";

export interface HistoryItem {
  id: string;
  query: string;
  code: string | null;
  kind: string;
  result_count: number | null;
  created_at: string;
}

export interface HistoryHandle {
  refresh: () => void;
}

const KIND: Record<string, { Icon: React.ElementType; cls: string }> = {
  lemon: { Icon: FileText, cls: "text-gray-400" },
  fulltext: { Icon: Search, cls: "text-gray-400" },
  compare: { Icon: GitCompare, cls: "text-indigo-500" },
};

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const HistoryPanel = forwardRef<HistoryHandle, { onPick: (code: string) => void }>(
  function HistoryPanel({ onPick }, ref) {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [open, setOpen] = useState(true);

    const load = useCallback(async () => {
      try {
        const res = await fetch("/api/dtc-lookup/history");
        if (!res.ok) return;
        const d = await res.json();
        setItems(d.items ?? []);
      } catch {
        /* history is a convenience, never block the page on it */
      }
    }, []);

    useEffect(() => {
      load();
    }, [load]);
    useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    async function clear() {
      await fetch("/api/dtc-lookup/history", { method: "DELETE" }).catch(() => {});
      setItems([]);
    }

    return (
      <div className="rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <History className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Search history
          </span>
          <span className="ml-auto text-[11px] text-gray-400">{items.length}</span>
        </button>

        {open && (
          <div className="border-t border-gray-100">
            {items.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400">
                Your lookups will show up here.
              </p>
            )}
            <ul className="max-h-64 overflow-y-auto">
              {items.map((h) => {
                const k = KIND[h.kind] ?? KIND.lemon;
                return (
                  <li key={h.id}>
                    <button
                      onClick={() => onPick(h.code ?? h.query)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
                    >
                      <k.Icon className={`h-3 w-3 shrink-0 ${k.cls}`} />
                      <span className="truncate font-mono text-xs text-gray-800">
                        {h.code ?? h.query}
                      </span>
                      {h.kind === "compare" && (
                        <span className="shrink-0 rounded bg-indigo-50 px-1 text-[10px] text-indigo-700">
                          compared
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                        {ago(h.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {items.length > 0 && (
              <button
                onClick={clear}
                className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-1.5 text-[11px] text-gray-400 hover:bg-gray-50 hover:text-rose-600"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);
