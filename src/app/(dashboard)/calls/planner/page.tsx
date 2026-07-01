"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Phone,
  PhoneCall,
  ArrowLeft,
  RefreshCw,
  Loader2,
  ChevronRight,
  CreditCard,
  Clock,
  TimerOff,
  UserX,
  Sparkles,
  BatteryLow,
  Hourglass,
  Moon,
  AlertTriangle,
  UserPlus,
  PlugZap,
  HeartHandshake,
  Target,
  Search,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { PLAYBOOKS } from "@/lib/calls/playbooks";
import { PLAN_TYPE_LABELS } from "@/lib/lists/filter-query";
import { COUNTRY_NAMES } from "@/lib/countries";
import { DEAL_ACCOUNT_DOMAINS } from "@/lib/calls/deal-accounts";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import type { ReasonTone } from "@/lib/calls/scoring";
import { CallNowButton } from "@/components/calls/call-now";

// How often to poll background enrichment progress (ms).
const QUEUE_POLL_MS = 6000;

const SEARCH_OUTCOME_CHIP: Record<string, { label: string; cls: string }> = {
  none: { label: "searched · none", cls: "bg-slate-100 text-slate-500" },
  blocked: { label: "searched · site blocked", cls: "bg-amber-50 text-amber-700" },
  error: { label: "searched · error", cls: "bg-red-50 text-red-600" },
};

const ICONS: Record<string, LucideIcon> = {
  CreditCard,
  Clock,
  TimerOff,
  UserX,
  Sparkles,
  BatteryLow,
  Hourglass,
  Moon,
  AlertTriangle,
  UserPlus,
  PlugZap,
  HeartHandshake,
};

const TONE_CHIP: Record<ReasonTone, string> = {
  danger: "bg-red-50 text-red-700 ring-red-600/20",
  warn: "bg-amber-50 text-amber-800 ring-amber-600/20",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  info: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const TONE_ACCENT: Record<string, string> = {
  danger: "border-l-red-400",
  warn: "border-l-amber-400",
  good: "border-l-emerald-400",
  info: "border-l-slate-300",
};

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

type Reason = { label: string; tone: ReasonTone; weight: number };

type TopContact = {
  contactId: string;
  name: string;
  email: string;
  phone: string | null;
  hasPhone: boolean;
  companyId: string | null;
  companyName: string | null;
  leadStatus: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  score: number;
  priority: "high" | "medium" | "low";
  reasons: Reason[];
  searchedAt: string | null;
  searchOutcome: string | null;
};

type PlaybookCount = { key: string; count: number; withPhone: number };

type Rep = { userId: string; number: number; name: string };

type PlannerData = {
  topContacts: TopContact[];
  topWithPhone: number;
  candidateCount: number;
  totalCandidateCount: number;
  freshCutoffDays: number;
  playbooks: PlaybookCount[];
  reps: Rep[];
  availableCountries: string[];
};

const UNASSIGNED_TOKEN = "unassigned";

export default function CallPlannerPage() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [topN, setTopN] = useState(20);
  const [findingNumbers, setFindingNumbers] = useState(false);
  const [includeSearched, setIncludeSearched] = useState(false);
  const [queue, setQueue] = useState<{ queued: number; processing: number } | null>(null);
  const [watching, setWatching] = useState(false);

  // ---- Call-list filters (narrow "today's top contacts" before it's built)
  const [showFilters, setShowFilters] = useState(false);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [excludePaying, setExcludePaying] = useState(false);
  const [excludeDeals, setExcludeDeals] = useState(false);
  // Owner tokens to *exclude* (canonical rep userId or UNASSIGNED_TOKEN). Empty
  // = include everyone, so no data-dependent initialisation is needed.
  const [excludedOwners, setExcludedOwners] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (countryFilter.length) params.set("countries", countryFilter.join(","));
      if (excludePaying) params.set("excludePaying", "1");
      if (excludeDeals) params.set("excludeDeals", "1");
      if (excludedOwners.size) params.set("excludeOwners", [...excludedOwners].join(","));
      const qs = params.toString();
      const res = await fetch(`/api/calls/planner${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setData(await res.json());
    } catch {
      toast.error("Failed to load the call planner");
    } finally {
      setLoading(false);
    }
  }, [countryFilter, excludePaying, excludeDeals, excludedOwners]);

  const toggleOwner = (token: string) =>
    setExcludedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });

  const toggleCountry = (code: string) =>
    setCountryFilter((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  const activeFilterCount =
    (countryFilter.length > 0 ? 1 : 0) +
    (excludePaying ? 1 : 0) +
    (excludeDeals ? 1 : 0) +
    (excludedOwners.size > 0 ? 1 : 0);

  const clearFilters = () => {
    setCountryFilter([]);
    setExcludePaying(false);
    setExcludeDeals(false);
    setExcludedOwners(new Set());
  };

  useEffect(() => {
    load();
  }, [load]);

  // While a background enrichment run is active, poll its progress. When the
  // queue drains, refresh the planner so newly-found numbers appear.
  useEffect(() => {
    if (!workspaceId || !watching) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/enrich/find-phone/queue-status?workspaceId=${workspaceId}`);
        if (!res.ok || !active) return;
        const s = await res.json();
        if (!active) return;
        setQueue({ queued: s.queued ?? 0, processing: s.processing ?? 0 });
        if ((s.queued ?? 0) === 0 && (s.processing ?? 0) === 0) {
          setWatching(false);
          await load();
        }
      } catch {
        /* transient — keep polling */
      }
    };
    poll();
    const t = setInterval(poll, QUEUE_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [watching, workspaceId, load]);

  const createFromPlaybook = async (key: string) => {
    setCreating(key);
    try {
      const res = await fetch("/api/calls/planner/create-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "playbook", playbookKey: key }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create list");
      toast.success("Call list created");
      router.push(`/calls/lists/${json.list.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setCreating(null);
    }
  };

  const startCallingTop = async () => {
    if (!data) return;
    const ids = data.topContacts.filter((c) => c.hasPhone).slice(0, topN).map((c) => c.contactId);
    if (ids.length === 0) {
      toast.error("None of your top contacts have a phone number yet");
      return;
    }
    setCreating("today");
    try {
      const res = await fetch("/api/calls/planner/create-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "today", contactIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create list");
      toast.success(`Call list created — ${ids.length} contacts`);
      router.push(`/calls/lists/${json.list.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setCreating(null);
    }
  };

  // Queue the number-less top contacts for background enrichment. The finder
  // discovers each contact's website (if missing), scrapes it, web-searches, and
  // saves the best number — server-side, so you can leave the page. Progress is
  // polled below and the list refreshes as numbers land.
  const findMissingNumbers = async () => {
    if (!data || findingNumbers) return;
    if (!workspaceId) {
      toast.error("No workspace loaded — reload the page");
      return;
    }
    const missing = data.topContacts.filter((c) => !c.hasPhone).map((c) => c.contactId);
    if (missing.length === 0) {
      toast("All your top contacts already have a phone number");
      return;
    }
    setFindingNumbers(true);
    try {
      const res = await fetch("/api/enrich/find-phone/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, contactIds: missing, force: includeSearched }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to queue");
      if (json.queued > 0) {
        toast.success(
          `Queued ${json.queued} contact${json.queued === 1 ? "" : "s"} — finding in the background`,
        );
        setQueue({ queued: json.queued, processing: 0 });
        setWatching(true);
      } else {
        const parts: string[] = [];
        if (json.skippedRecent) parts.push(`${json.skippedRecent} already searched`);
        if (json.skippedOpen) parts.push(`${json.skippedOpen} already queued`);
        toast(
          parts.length
            ? `Nothing new to queue — ${parts.join(", ")}. Tick "re-search" to force.`
            : "Nothing to queue",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue");
    } finally {
      setFindingNumbers(false);
    }
  };

  const countFor = (key: string) => data?.playbooks.find((p) => p.key === key);
  const callableTop = data?.topContacts.filter((c) => c.hasPhone).length ?? 0;
  const missingTop = data ? data.topContacts.filter((c) => !c.hasPhone).length : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/calls" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Target className="h-5 w-5 text-indigo-600" />
          <h1 className="text-xl font-semibold text-slate-900">Call Planner</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 ${
              showFilters || activeFilterCount > 0
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" /> Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Who to call today, ranked by relevance — and ready-made segments you can turn into a call
        list in one click. People you&apos;ve already called drop off automatically.
      </p>

      {data && showFilters && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Refine who to call
            </h3>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Clear all
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Applies to Today&apos;s top contacts and the list you build with &ldquo;Start calling
            these&rdquo;.
          </p>

          {/* Countries */}
          {data.availableCountries.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-slate-600">Countries</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.availableCountries.map((code) => {
                  const on = countryFilter.includes(code);
                  return (
                    <button
                      key={code}
                      onClick={() => toggleCountry(code)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        on
                          ? "border-indigo-300 bg-indigo-100 text-indigo-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {COUNTRY_NAMES[code] ?? code}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {countryFilter.length === 0
                  ? "All countries"
                  : `Only ${countryFilter.length} selected`}
              </p>
            </div>
          )}

          {/* Toggles */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={excludePaying}
                onChange={(e) => setExcludePaying(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Exclude paying customers
            </label>
            <label
              className="flex items-center gap-2 text-xs text-slate-700"
              title={`Skip contacts at ${DEAL_ACCOUNT_DOMAINS.join(", ")} — Hans is working these as direct deals`}
            >
              <input
                type="checkbox"
                checked={excludeDeals}
                onChange={(e) => setExcludeDeals(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Exclude Hans&apos;s deal accounts ({DEAL_ACCOUNT_DOMAINS.join(", ")})
            </label>
          </div>

          {/* Owner assignment */}
          <div className="mt-3">
            <div className="text-xs font-medium text-slate-600">Assigned to</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[
                ...data.reps.map((r) => ({ token: r.userId, label: r.name })),
                { token: UNASSIGNED_TOKEN, label: "Unassigned" },
              ].map(({ token, label }) => {
                const included = !excludedOwners.has(token);
                return (
                  <button
                    key={token}
                    onClick={() => toggleOwner(token)}
                    title={included ? "Included — click to exclude" : "Excluded — click to include"}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      included
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-400 line-through"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Click a name to drop contacts owned by that rep (or with no owner).
            </p>
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="mt-10 flex items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {data && (
        <>
          {/* ---- Today's top contacts ---- */}
          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Phone className="h-4 w-4" /> Today&apos;s top contacts
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {data.topContacts.length} ranked · {callableTop} have a phone ·{" "}
                  {data.candidateCount}
                  {activeFilterCount > 0 && data.totalCandidateCount !== data.candidateCount
                    ? ` of ${data.totalCandidateCount}`
                    : ""}{" "}
                  app users analysed
                  {activeFilterCount > 0 ? " (filtered)" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {missingTop > 0 && (
                  <>
                    <label
                      className="flex items-center gap-1 text-xs text-slate-500"
                      title="Also re-search contacts already searched in the last 14 days"
                    >
                      <input
                        type="checkbox"
                        checked={includeSearched}
                        onChange={(e) => setIncludeSearched(e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      re-search
                    </label>
                    <button
                      onClick={findMissingNumbers}
                      disabled={findingNumbers}
                      title="Queue the top contacts without a number for background phone enrichment"
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {findingNumbers ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      Find missing numbers
                    </button>
                  </>
                )}
                <label className="text-xs text-slate-500">Top</label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(callableTop, 1)}
                  value={topN}
                  onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={startCallingTop}
                  disabled={creating === "today" || callableTop === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creating === "today" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneCall className="h-4 w-4" />
                  )}
                  Start calling these
                </button>
              </div>
            </div>

            {watching && queue && (queue.queued > 0 || queue.processing > 0) && (
              <p className="mt-2 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Finding numbers in the background — {queue.queued + queue.processing} remaining. You
                can leave this page; numbers appear as they&apos;re found.
              </p>
            )}

            {callableTop < data.topContacts.length && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {data.topContacts.length - callableTop} of your top contacts have no phone number yet
                — hit <span className="font-medium">Find missing numbers</span> to look them up in the
                background, or they&apos;ll be skipped when you start calling.
              </p>
            )}

            <div className="mt-3 space-y-2">
              {data.topContacts.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  No contacts to call right now. Everyone relevant has been contacted within the last{" "}
                  {data.freshCutoffDays} days — check back tomorrow.
                </p>
              )}
              {data.topContacts.map((c, i) => (
                <div
                  key={c.contactId}
                  className={`flex items-start gap-3 rounded-lg border border-slate-200 border-l-4 bg-white p-3 ${
                    TONE_ACCENT[c.reasons[0]?.tone ?? "info"]
                  }`}
                >
                  <div className="mt-0.5 w-6 shrink-0 text-center text-sm font-semibold text-slate-400">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/contacts/${c.contactId}`}
                        className="text-sm font-medium text-slate-900 hover:text-indigo-600"
                      >
                        {c.name}
                      </Link>
                      {c.companyName && (
                        <span className="truncate text-xs text-slate-500">· {c.companyName}</span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          PRIORITY_BADGE[c.priority]
                        }`}
                      >
                        {c.priority}
                      </span>
                      {c.plan && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                          {PLAN_TYPE_LABELS[c.plan] ?? c.plan}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.reasons.map((r, ri) => (
                        <span
                          key={ri}
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                            TONE_CHIP[r.tone]
                          }`}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {c.phone ? (
                      <CallNowButton
                        target={{
                          contactId: c.contactId,
                          contactName: c.name,
                          phone: c.phone,
                          companyId: c.companyId,
                          companyName: c.companyName,
                        }}
                      />
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Link
                          href={`/contacts/${c.contactId}`}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                        >
                          Find number <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                        {c.searchOutcome && SEARCH_OUTCOME_CHIP[c.searchOutcome] && (
                          <span
                            title={
                              c.searchedAt
                                ? `Last searched ${new Date(c.searchedAt).toLocaleDateString()}`
                                : undefined
                            }
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              SEARCH_OUTCOME_CHIP[c.searchOutcome].cls
                            }`}
                          >
                            {SEARCH_OUTCOME_CHIP[c.searchOutcome].label}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ---- Playbooks ---- */}
          <section className="mt-8">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Sparkles className="h-4 w-4 text-amber-500" /> Playbooks
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Ready-made segments. A contact can appear in several — that&apos;s fine, calls are
              deduped automatically.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PLAYBOOKS.map((pb) => {
                const cnt = countFor(pb.key);
                const Icon = ICONS[pb.icon] ?? Sparkles;
                const isCreating = creating === pb.key;
                const empty = (cnt?.count ?? 0) === 0;
                return (
                  <div
                    key={pb.key}
                    className={`flex flex-col rounded-xl border border-slate-200 border-t-4 bg-white p-4 ${
                      TONE_ACCENT[pb.tone].replace("border-l-", "border-t-")
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-900">{pb.label}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-slate-900">
                          {cnt ? cnt.count.toLocaleString() : "—"}
                        </div>
                        {cnt && cnt.count > 0 && (
                          <div className="text-[10px] text-slate-400">{cnt.withPhone} w/ phone</div>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-500">{pb.hint}</p>
                    <p className="mt-1.5 flex-1 text-xs text-slate-500">{pb.rationale}</p>
                    <button
                      onClick={() => createFromPlaybook(pb.key)}
                      disabled={isCreating || empty}
                      className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isCreating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PhoneCall className="h-3.5 w-3.5" />
                      )}
                      {empty ? "No contacts" : "Create call list"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
