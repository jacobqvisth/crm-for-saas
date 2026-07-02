"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Phone, ArrowLeft, Loader2, Check, Building2, MapPin, Wrench, ChevronRight, Search, User, Pencil, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calls/decision";
import { CallLogger, type CallLoggerTarget } from "@/components/calls/call-logger";
import { CallNowButton } from "@/components/calls/call-now";
import { ContactCallPanel } from "@/components/calls/contact-call-panel";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { createClient } from "@/lib/supabase/client";

// The bulk find-numbers endpoint caps each request at 6 contacts; chunk to match.
const FIND_BATCH = 6;
// Don't fan out over an unbounded list in one click.
const FIND_CAP = 30;

export type QueueRow = {
  contactId: string;
  name: string;
  email: string;
  phone: string | null;
  allPhones: string[];
  allEmails: string[];
  title: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  language: string | null;
  leadStatus: string | null;
  tags: string[];
  notes: string | null;
  companyId: string | null;
  companyName: string | null;
  companyPhone: string | null;
  companyCity: string | null;
  isCustomer: boolean;
  appRole: string | null;
  planType: string | null;
  subscriptionStatus: string | null;
  diagnosticsTotal: number | null;
  diagnosticsLast30d: number | null;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
  lastContactedAt: string | null;
  lastCall: {
    outcome: string | null;
    created_at: string | null;
    agentName: string | null;
    agentAvatarUrl: string | null;
  } | null;
};

type ListInfo = { id: string; name: string; description: string | null; is_dynamic: boolean | null };

type Filter = "all" | "prospects" | "customers" | "uncalled";

export default function CallListPage() {
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const { workspaceId } = useWorkspace();
  const [list, setList] = useState<ListInfo | null>(null);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [active, setActive] = useState<CallLoggerTarget | null>(null);
  const [openRow, setOpenRow] = useState<QueueRow | null>(null);
  const [findingNumbers, setFindingNumbers] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Inline-rename the list, mirroring the pattern on the general list-detail page
  // (src/components/lists/list-detail-client.tsx). Writes straight to contact_lists
  // via the browser Supabase client under RLS — there is no rename API route.
  const handleSaveName = async () => {
    const next = nameInput.trim();
    if (!list || !next || next === list.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("contact_lists")
      .update({ name: next })
      .eq("id", list.id);
    setSavingName(false);
    if (error) {
      toast.error("Failed to rename list");
      return;
    }
    setList({ ...list, name: next });
    toast.success("List renamed");
    setEditingName(false);
  };

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

  // Keep the open side panel in sync with refreshed queue data (e.g. after a call is logged).
  useEffect(() => {
    setOpenRow((cur) => (cur ? queue.find((r) => r.contactId === cur.contactId) ?? cur : cur));
  }, [queue]);

  const filtered = queue.filter((r) => {
    if (filter === "prospects") return !r.isCustomer;
    if (filter === "customers") return r.isCustomer;
    if (filter === "uncalled") return !r.lastCall;
    return true;
  });

  const calledCount = queue.filter((r) => r.lastCall).length;
  const progress = queue.length > 0 ? Math.round((calledCount / queue.length) * 100) : 0;

  // Contacts on this list with no callable number (neither their own nor their
  // company's) — the ones the finder can help with.
  const missingPhone = queue.filter((r) => !r.phone && !r.companyPhone);

  // Bulk-find phone numbers for the contacts on this list that don't have one.
  // The finder discovers each contact's website first (if missing), scrapes it,
  // then web-searches — saving the best number so they become callable. Runs in
  // small batches so we stay inside the serverless time limit. Mirrors the Call
  // Planner's "Find missing numbers" action.
  const findMissingNumbers = async () => {
    if (findingNumbers) return;
    if (!workspaceId) {
      toast.error("No workspace loaded — reload the page");
      return;
    }
    const missing = missingPhone.slice(0, FIND_CAP);
    if (missing.length === 0) {
      toast("Everyone on this list already has a phone number");
      return;
    }
    setFindingNumbers(true);
    const toastId = toast.loading(`Finding numbers… 0/${missing.length}`);
    let done = 0;
    let saved = 0;
    let withNumbers = 0;
    try {
      for (let i = 0; i < missing.length; i += FIND_BATCH) {
        const batch = missing.slice(i, i + FIND_BATCH).map((c) => c.contactId);
        const res = await fetch("/api/enrich/find-phone/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, contactIds: batch }),
        });
        const json = await res.json();
        if (res.ok) {
          saved += json.savedTotal ?? 0;
          withNumbers += json.withNumbers ?? 0;
        }
        done += batch.length;
        toast.loading(`Finding numbers… ${done}/${missing.length}`, { id: toastId });
      }
      if (saved > 0) {
        toast.success(
          `Found numbers for ${withNumbers} contact${withNumbers === 1 ? "" : "s"} (${saved} saved)`,
          { id: toastId },
        );
      } else {
        toast.error("No new phone numbers found for these contacts", { id: toastId });
      }
      await load();
    } catch {
      toast.error("Find numbers failed", { id: toastId });
    } finally {
      setFindingNumbers(false);
    }
  };

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
          {editingName && list ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                disabled={savingName}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xl font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50"
                title="Save name"
              >
                {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setEditingName(false)}
                disabled={savingName}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
                title="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <h1
              className="group inline-flex cursor-pointer items-center gap-2 text-xl font-semibold text-slate-900 hover:text-indigo-600"
              onClick={() => {
                if (!list) return;
                setNameInput(list.name);
                setEditingName(true);
              }}
              title="Click to rename this call list"
            >
              {list?.name ?? "Call list"}
              {list && <Pencil className="h-4 w-4 text-slate-400 opacity-0 group-hover:opacity-100" />}
            </h1>
          )}
          {list?.description && <p className="mt-0.5 text-sm text-slate-500">{list.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {missingPhone.length > 0 && (
            <button
              onClick={findMissingNumbers}
              disabled={findingNumbers}
              title={`Find websites + phone numbers for the ${missingPhone.length} contact${missingPhone.length === 1 ? "" : "s"} on this list without one${missingPhone.length > FIND_CAP ? ` (up to ${FIND_CAP} per run)` : ""}`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {findingNumbers ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Find numbers
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                {Math.min(missingPhone.length, FIND_CAP)}
              </span>
            </button>
          )}
          <Link
            href={`/lists/${listId}`}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Manage contacts
          </Link>
        </div>
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
            <div
              key={r.contactId}
              className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${openRow?.contactId === r.contactId ? "bg-indigo-50/60" : ""}`}
            >
              {r.lastCall ? (
                r.lastCall.agentAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.lastCall.agentAvatarUrl}
                    alt={r.lastCall.agentName ?? "Caller"}
                    title={r.lastCall.agentName ? `Last call by ${r.lastCall.agentName}` : "Called"}
                    className="h-6 w-6 shrink-0 rounded-full object-cover ring-2 ring-emerald-300"
                  />
                ) : (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
                    title={r.lastCall.agentName ? `Last call by ${r.lastCall.agentName}` : "Called"}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-slate-300" />
              )}

              {/* Clickable info area → opens contact side panel */}
              <button
                type="button"
                onClick={() => setOpenRow(r)}
                className="group flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600">{r.name}</span>
                    {r.isCustomer && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Customer</span>
                    )}
                    {r.leadStatus && !r.isCustomer && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{r.leadStatus}</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    {(r.title || r.companyName) && (
                      <span className="inline-flex max-w-full items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate">{[r.title, r.companyName].filter(Boolean).join(" · ")}</span>
                      </span>
                    )}
                    {r.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
                        {r.city}
                      </span>
                    )}
                    {r.isCustomer && r.diagnosticsTotal != null && (
                      <span className="inline-flex items-center gap-1">
                        <Wrench className="h-3 w-3 shrink-0 text-slate-400" />
                        {r.diagnosticsTotal} diag
                      </span>
                    )}
                    {r.lastCall?.outcome && (
                      <span className="text-slate-600">
                        {CALL_OUTCOME_LABEL[r.lastCall.outcome as CallOutcome] ?? r.lastCall.outcome}
                        {r.lastCall.created_at && ` · ${formatDistanceToNow(new Date(r.lastCall.created_at), { addSuffix: true })}`}
                      </span>
                    )}
                    {r.lastCall?.agentName && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                        title={`Last call by ${r.lastCall.agentName}`}
                      >
                        <User className="h-2.5 w-2.5" />
                        {r.lastCall.agentName}
                      </span>
                    )}
                    {!r.title && !r.companyName && !r.city && !r.lastCall && (
                      <span className="truncate">{r.email}</span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-indigo-400" />
              </button>

              {(r.phone || r.companyPhone) && (
                <a
                  href={`tel:${r.phone ?? r.companyPhone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hidden shrink-0 text-xs text-slate-500 hover:text-teal-700 sm:block"
                >
                  {r.phone ?? r.companyPhone}
                </a>
              )}
              <CallNowButton
                target={{
                  contactId: r.contactId,
                  contactName: r.name,
                  phone: r.phone,
                  companyId: r.companyId,
                  companyName: r.companyName,
                  listId,
                }}
                onLogged={load}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              />
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
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Phone className="h-3.5 w-3.5" /> Log
              </button>
            </div>
          ))}
        </div>
      )}

      {openRow && (
        <ContactCallPanel
          row={openRow}
          listId={listId}
          onClose={() => setOpenRow(null)}
          onCallLogged={load}
          onLog={() =>
            setActive({
              contactId: openRow.contactId,
              name: openRow.name,
              phone: openRow.phone,
              companyId: openRow.companyId,
              companyName: openRow.companyName,
              isCustomer: openRow.isCustomer,
              listId,
            })
          }
        />
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
