"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, Plus, ListChecks, MessageSquare, Target, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { NewCallListModal } from "@/components/calls/new-call-list-modal";
import { CallDetailDrawer } from "@/components/calls/call-now";

type Stats = {
  callsToday: number;
  callsThisWeek: number;
  connectRate: number;
  interestedThisWeek: number;
  callbacksDue: number;
  openFeedback: number;
};

type CallRow = {
  id: string;
  created_at: string | null;
  outcome: string | null;
  subject: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown> | null;
  contacts: { first_name: string | null; last_name: string | null; email: string; wl_user_id: string | null } | null;
  companies: { name: string | null } | null;
};

type OpenCall = { sessionId: string; contactId: string | null; name: string; companyName: string | null };

type CallList = {
  id: string;
  name: string;
  description: string | null;
  is_dynamic: boolean | null;
  memberCount: number;
};

const PAGE_SIZE = 50;

type CallFilter = "today" | "yesterday" | "last7";

const CALL_FILTERS: { id: CallFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
];

// Date range for a filter, in the browser's local timezone (Stockholm for this team).
// Returns ISO (UTC) strings suitable for the /api/calls since/until params.
function rangeFor(filter: CallFilter): { since: string; until?: string } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBefore = (d: Date, days: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() - days);
    return x;
  };
  // 1ms before today's midnight — exclusive upper bound so a 00:00 call isn't double-counted.
  const endOfYesterday = new Date(startOfToday.getTime() - 1).toISOString();
  if (filter === "today") return { since: startOfToday.toISOString() };
  if (filter === "yesterday")
    return { since: daysBefore(startOfToday, 1).toISOString(), until: endOfYesterday };
  // last7: the 7 full days before today (not including today)
  return { since: daysBefore(startOfToday, 7).toISOString(), until: endOfYesterday };
}

export default function CallsOverviewPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [lists, setLists] = useState<CallList[]>([]);
  const [loading, setLoading] = useState(true);
  const [callsLoading, setCallsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [callFilter, setCallFilter] = useState<CallFilter>("today");
  const [showNew, setShowNew] = useState(false);
  const [openCall, setOpenCall] = useState<OpenCall | null>(null);

  // Stats + call lists load once.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        fetch("/api/calls/stats").then((r) => r.json()),
        fetch("/api/calls/lists").then((r) => r.json()),
      ]);
      setStats(s);
      setLists(l.lists ?? []);
    } catch {
      toast.error("Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  // Recent calls reload when the date filter changes; paginate via offset.
  const loadCalls = useCallback(async (filter: CallFilter, offset: number) => {
    const append = offset > 0;
    if (append) setLoadingMore(true);
    else setCallsLoading(true);
    try {
      const { since, until } = rangeFor(filter);
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        since,
      });
      if (until) params.set("until", until);
      const res = await fetch(`/api/calls?${params.toString()}`).then((r) => r.json());
      const rows: CallRow[] = res.calls ?? [];
      setCalls((prev) => (append ? [...prev, ...rows] : rows));
      setCallsTotal(res.total ?? 0);
    } catch {
      toast.error("Failed to load recent calls");
    } finally {
      if (append) setLoadingMore(false);
      else setCallsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCalls(callFilter, 0);
  }, [callFilter, loadCalls]);

  const cards = stats
    ? [
        { label: "Calls today", value: stats.callsToday },
        { label: "This week", value: stats.callsThisWeek },
        { label: "Connect rate", value: `${stats.connectRate}%` },
        { label: "Interested (7d)", value: stats.interestedThisWeek },
        { label: "Callbacks due", value: stats.callbacksDue },
        { label: "Open feedback", value: stats.openFeedback },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Calls</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/calls/planner"
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <Target className="h-4 w-4" /> Plan today&apos;s calls
          </Link>
          <Link
            href="/calls/feedback"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <MessageSquare className="h-4 w-4" /> Feedback
          </Link>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> New call list
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-2xl font-semibold text-slate-900">{c.value}</div>
            <div className="mt-1 text-xs text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ListChecks className="h-4 w-4" /> Call lists
          </h2>
          {lists.length === 0 && !loading && (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              No call lists yet. Create one to start working a calling queue.
            </p>
          )}
          <div className="space-y-2">
            {lists.map((l) => (
              <Link
                key={l.id}
                href={`/calls/lists/${l.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-indigo-300 hover:bg-indigo-50/30"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">{l.name}</span>
                  <span className="text-xs text-slate-500">
                    {l.memberCount} {l.memberCount === 1 ? "contact" : "contacts"}
                  </span>
                </div>
                {l.description && <p className="mt-0.5 text-xs text-slate-500">{l.description}</p>}
                {l.is_dynamic && (
                  <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    Dynamic
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Phone className="h-4 w-4" /> Recent calls
            </h2>
            {!callsLoading && (
              <span className="text-xs text-slate-400">
                {callsTotal} {callsTotal === 1 ? "call" : "calls"}
              </span>
            )}
          </div>
          <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {CALL_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setCallFilter(f.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  callFilter === f.id
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {calls.length === 0 && !callsLoading && (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              No calls in this period.
            </p>
          )}
          <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
            {calls.map((c) => {
              const name =
                [c.contacts?.first_name, c.contacts?.last_name].filter(Boolean).join(" ").trim() ||
                c.contacts?.email ||
                "Unknown";
              // Inbound calling is a newer feature; legacy calls with no direction are outbound.
              const isInbound = c.metadata?.direction === "inbound";
              const rowInner = (
                <>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm text-slate-900">
                      <span className="truncate">{name}</span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          isInbound ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {isInbound ? (
                          <PhoneIncoming className="h-2.5 w-2.5" />
                        ) : (
                          <PhoneOutgoing className="h-2.5 w-2.5" />
                        )}
                        {isInbound ? "Inbound" : "Outbound"}
                      </span>
                      {c.contacts?.wl_user_id && (
                        <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                          Customer
                        </span>
                      )}
                    </div>
                    {c.companies?.name && (
                      <div className="truncate text-xs text-slate-500">{c.companies.name}</div>
                    )}
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    {c.outcome && (
                      <div className="text-xs font-medium text-slate-700">
                        {CALL_OUTCOME_LABEL[c.outcome as CallOutcome] ?? c.outcome}
                      </div>
                    )}
                    {c.created_at && (
                      <div className="text-[11px] text-slate-400">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                </>
              );
              const sessionId = c.metadata?.call_session_id as string | undefined;
              if (sessionId) {
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setOpenCall({
                        sessionId,
                        contactId: c.contact_id,
                        name,
                        companyName: c.companies?.name ?? null,
                      })
                    }
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
                  >
                    {rowInner}
                  </button>
                );
              }
              return c.contact_id ? (
                <Link
                  key={c.id}
                  href={`/contacts/${c.contact_id}`}
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50"
                >
                  {rowInner}
                </Link>
              ) : (
                <div key={c.id} className="flex items-center justify-between px-3 py-2.5">
                  {rowInner}
                </div>
              );
            })}
          </div>
          {calls.length < callsTotal && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => loadCalls(callFilter, calls.length)}
                disabled={loadingMore}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : `Load more (${callsTotal - calls.length} left)`}
              </button>
            </div>
          )}
        </section>
      </div>

      {showNew && <NewCallListModal onClose={() => setShowNew(false)} onCreated={(id) => router.push(`/calls/lists/${id}`)} />}

      {openCall && (
        <CallDetailDrawer
          sessionId={openCall.sessionId}
          target={{
            contactId: openCall.contactId ?? "",
            contactName: openCall.name,
            phone: null,
            companyId: null,
            companyName: openCall.companyName,
          }}
          contactHref={openCall.contactId ? `/contacts/${openCall.contactId}` : undefined}
          onClose={() => setOpenCall(null)}
        />
      )}
    </div>
  );
}
