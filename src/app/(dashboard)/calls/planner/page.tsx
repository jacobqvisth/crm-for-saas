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
  type LucideIcon,
} from "lucide-react";
import toast from "react-hot-toast";
import { PLAYBOOKS } from "@/lib/calls/playbooks";
import { PLAN_TYPE_LABELS } from "@/lib/lists/filter-query";
import type { ReasonTone } from "@/lib/calls/scoring";
import { CallNowButton } from "@/components/calls/call-now";

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
};

type PlaybookCount = { key: string; count: number; withPhone: number };

type PlannerData = {
  topContacts: TopContact[];
  topWithPhone: number;
  candidateCount: number;
  freshCutoffDays: number;
  playbooks: PlaybookCount[];
};

export default function CallPlannerPage() {
  const router = useRouter();
  const [data, setData] = useState<PlannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [topN, setTopN] = useState(20);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/calls/planner");
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setData(await res.json());
    } catch {
      toast.error("Failed to load the call planner");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const countFor = (key: string) => data?.playbooks.find((p) => p.key === key);
  const callableTop = data?.topContacts.filter((c) => c.hasPhone).length ?? 0;

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
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Who to call today, ranked by relevance — and ready-made segments you can turn into a call
        list in one click. People you&apos;ve already called drop off automatically.
      </p>

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
                  {data.candidateCount} app users analysed
                </p>
              </div>
              <div className="flex items-center gap-2">
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

            {callableTop < data.topContacts.length && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {data.topContacts.length - callableTop} of your top contacts have no phone number yet
                — open a contact to find a number, or they&apos;ll be skipped when you start calling.
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
                      <Link
                        href={`/contacts/${c.contactId}`}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        Find number <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
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
