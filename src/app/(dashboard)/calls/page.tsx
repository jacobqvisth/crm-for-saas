"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, Plus, ListChecks, MessageSquare } from "lucide-react";
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

export default function CallsOverviewPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [lists, setLists] = useState<CallList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openCall, setOpenCall] = useState<OpenCall | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, l] = await Promise.all([
        fetch("/api/calls/stats").then((r) => r.json()),
        fetch("/api/calls?limit=15").then((r) => r.json()),
        fetch("/api/calls/lists").then((r) => r.json()),
      ]);
      setStats(s);
      setCalls(c.calls ?? []);
      setLists(l.lists ?? []);
    } catch {
      toast.error("Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Phone className="h-4 w-4" /> Recent calls
          </h2>
          {calls.length === 0 && !loading && (
            <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              No calls logged yet.
            </p>
          )}
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {calls.map((c) => {
              const name =
                [c.contacts?.first_name, c.contacts?.last_name].filter(Boolean).join(" ").trim() ||
                c.contacts?.email ||
                "Unknown";
              const rowInner = (
                <>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-900">
                      {name}
                      {c.contacts?.wl_user_id && (
                        <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
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
