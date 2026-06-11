"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Phone, ArrowLeft, Loader2, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { CallLogger, type CallLoggerTarget } from "@/components/calls/call-logger";

type QueueRow = {
  contactId: string;
  name: string;
  email: string;
  phone: string | null;
  leadStatus: string | null;
  companyId: string | null;
  companyName: string | null;
  isCustomer: boolean;
  lastContactedAt: string | null;
  lastCall: { outcome: string | null; created_at: string | null } | null;
};

type ListInfo = { id: string; name: string; description: string | null; is_dynamic: boolean | null };

type Filter = "all" | "prospects" | "customers" | "uncalled";

export default function CallListPage() {
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const [list, setList] = useState<ListInfo | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState<CallLoggerTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calls/lists/${listId}/queue?limit=200`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load list");
      setList(json.list);
      setQueue(json.queue ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load list");
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = queue.filter((r) => {
    if (filter === "prospects") return !r.isCustomer;
    if (filter === "customers") return r.isCustomer;
    if (filter === "uncalled") return !r.lastCall;
    return true;
  });

  const calledCount = queue.filter((r) => r.lastCall).length;
  const progress = queue.length > 0 ? Math.round((calledCount / queue.length) * 100) : 0;

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `All (${queue.length})` },
    { key: "uncalled", label: "Not called" },
    { key: "prospects", label: "Prospects" },
    { key: "customers", label: "Customers" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <Link href="/calls" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Calls
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{list?.name ?? "Call list"}</h1>
          {list?.description && <p className="mt-0.5 text-sm text-slate-500">{list.description}</p>}
        </div>
        <Link
          href={`/lists/${listId}`}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Manage contacts
        </Link>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{calledCount} of {queue.length} called{total > queue.length ? ` (showing ${queue.length} of ${total})` : ""}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-4 flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${filter === t.key ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">No contacts match this filter.</p>
          )}
          {filtered.map((r) => (
            <div key={r.contactId} className="flex items-center gap-3 px-4 py-3">
              {r.lastCall ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <Check className="h-3.5 w-3.5" />
                </span>
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-slate-300" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">{r.name}</span>
                  {r.isCustomer && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Customer</span>
                  )}
                  {r.leadStatus && !r.isCustomer && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{r.leadStatus}</span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {r.companyName ?? r.email}
                  {r.lastCall?.outcome && (
                    <>
                      {" · "}
                      <span className="text-slate-600">{CALL_OUTCOME_LABEL[r.lastCall.outcome as CallOutcome] ?? r.lastCall.outcome}</span>
                      {r.lastCall.created_at && ` ${formatDistanceToNow(new Date(r.lastCall.created_at), { addSuffix: true })}`}
                    </>
                  )}
                </div>
              </div>

              {r.phone && (
                <a
                  href={`tel:${r.phone}`}
                  className="hidden shrink-0 text-xs text-slate-500 hover:text-indigo-600 sm:block"
                >
                  {r.phone}
                </a>
              )}
              <button
                onClick={() =>
                  setActive({
                    contactId: r.contactId,
                    name: r.name,
                    phone: r.phone,
                    companyId: r.companyId,
                    companyName: r.companyName,
                    isCustomer: r.isCustomer,
                    listId,
                  })
                }
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Phone className="h-3.5 w-3.5" /> Log
              </button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <CallLogger
          target={active}
          onClose={() => setActive(null)}
          onLogged={() => {
            setActive(null);
            load();
          }}
        />
      )}
    </div>
  );
}
