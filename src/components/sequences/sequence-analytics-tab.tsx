"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { notNull } from "@/lib/types/guards";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ArrowRight, ChevronDown, ChevronRight, Trophy } from "lucide-react";
import toast from "react-hot-toast";

interface VariantAnalytics {
  id: string;
  name: string;
  weight: number;
  is_active: boolean;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

interface StepAnalytics {
  step_id: string;
  step_order: number;
  type: string;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  variants: VariantAnalytics[];
}

interface SequenceAnalyticsTabProps {
  sequenceId: string;
}

export function SequenceAnalyticsTab({ sequenceId }: SequenceAnalyticsTabProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [stepAnalytics, setStepAnalytics] = useState<StepAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStepExpansion = (stepId: string) => {
    const next = new Set(expandedSteps);
    if (next.has(stepId)) next.delete(stepId);
    else next.add(stepId);
    setExpandedSteps(next);
  };

  const promoteWinner = async (step: StepAnalytics) => {
    const eligibleVariants = step.variants.filter((v) => v.sent >= 20);
    if (eligibleVariants.length < 2) {
      toast.error("Need ≥2 variants with ≥20 sends each to promote a winner");
      return;
    }
    const winner = eligibleVariants.reduce((a, b) =>
      a.replied / Math.max(1, a.sent) >= b.replied / Math.max(1, b.sent) ? a : b,
    );
    if (
      !confirm(
        `Promote "${winner.name}" to weight 5 and set every other variant on this step to weight 1?`,
      )
    ) {
      return;
    }
    for (const v of step.variants) {
      const weight = v.id === winner.id ? 5 : 1;
      await fetch(
        `/api/sequences/${sequenceId}/steps/${step.step_id}/variants/${v.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weight }),
        },
      );
    }
    toast.success(`Promoted "${winner.name}"`);
    load();
  };

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data: steps } = await supabase
      .from("sequence_steps")
      .select("*")
      .eq("sequence_id", sequenceId)
      .order("step_order");

    if (!steps) {
      setLoading(false);
      return;
    }

    const analytics: StepAnalytics[] = [];

    // Pre-fetch all variants for every step in this sequence so we can build
    // per-variant breakdowns without N+1 queries.
    const stepIds = steps.filter((s) => s.type === "email").map((s) => s.id);
    const variantsByStep = new Map<string, Array<{ id: string; name: string; weight: number; is_active: boolean }>>();
    if (stepIds.length > 0) {
      const { data: allVariants } = await supabase
        .from("sequence_step_variants")
        .select("id, sequence_step_id, name, weight, is_active")
        .in("sequence_step_id", stepIds);
      for (const v of allVariants ?? []) {
        const arr = variantsByStep.get(v.sequence_step_id) ?? [];
        arr.push(v);
        variantsByStep.set(v.sequence_step_id, arr);
      }
    }

    for (const step of steps) {
      if (step.type !== "email") continue;

      const { data: queueItems } = await supabase
        .from("email_queue")
        .select("id, tracking_id, status, variant_id")
        .eq("step_id", step.id)
        .eq("workspace_id", workspaceId);

      const sent = (queueItems || []).filter((q) => q.status === "sent").length;
      const trackingIds = (queueItems || []).map((q) => q.tracking_id).filter(notNull);

      // tracking_id → variant_id for this step's queue rows
      const trackingToVariant = new Map<string, string | null>();
      for (const q of queueItems ?? []) {
        if (q.tracking_id) trackingToVariant.set(q.tracking_id, q.variant_id ?? null);
      }

      let opened = 0;
      let clicked = 0;
      let replied = 0;
      let bounced = 0;
      let unsubscribed = 0;

      // Per-variant event sets (Map<variantId, Set<trackingId>>). null key
      // means "no variant" (legacy fallback path).
      const openedByVariant = new Map<string | null, Set<string>>();
      const clickedByVariant = new Map<string | null, Set<string>>();
      const repliedByVariant = new Map<string | null, Set<string>>();
      const bouncedByVariant = new Map<string | null, Set<string>>();
      const sentByVariant = new Map<string | null, number>();

      for (const q of queueItems ?? []) {
        if (q.status === "sent") {
          sentByVariant.set(q.variant_id ?? null, (sentByVariant.get(q.variant_id ?? null) ?? 0) + 1);
        }
      }

      if (trackingIds.length > 0) {
        const { data: events } = await supabase
          .from("email_events")
          .select("event_type, tracking_id")
          .in("tracking_id", trackingIds);

        if (events) {
          const uniqueOpened = new Set<string>();
          const uniqueClicked = new Set<string>();
          const uniqueReplied = new Set<string>();
          const uniqueBounced = new Set<string>();
          const uniqueUnsub = new Set<string>();

          for (const ev of events) {
            if (ev.event_type === "open") uniqueOpened.add(ev.tracking_id);
            if (ev.event_type === "click") uniqueClicked.add(ev.tracking_id);
            if (ev.event_type === "reply") uniqueReplied.add(ev.tracking_id);
            if (ev.event_type === "bounce") uniqueBounced.add(ev.tracking_id);
            if (ev.event_type === "unsubscribe") uniqueUnsub.add(ev.tracking_id);
          }

          opened = uniqueOpened.size;
          clicked = uniqueClicked.size;
          replied = uniqueReplied.size;
          bounced = uniqueBounced.size;
          unsubscribed = uniqueUnsub.size;

          const addToVariantSet = (
            map: Map<string | null, Set<string>>,
            tid: string,
          ) => {
            const vid = trackingToVariant.get(tid) ?? null;
            if (!map.has(vid)) map.set(vid, new Set());
            map.get(vid)!.add(tid);
          };
          for (const tid of uniqueOpened) addToVariantSet(openedByVariant, tid);
          for (const tid of uniqueClicked) addToVariantSet(clickedByVariant, tid);
          for (const tid of uniqueReplied) addToVariantSet(repliedByVariant, tid);
          for (const tid of uniqueBounced) addToVariantSet(bouncedByVariant, tid);
        }
      }

      const variantAnalytics: VariantAnalytics[] = (variantsByStep.get(step.id) ?? []).map(
        (v) => ({
          id: v.id,
          name: v.name,
          weight: v.weight,
          is_active: v.is_active,
          sent: sentByVariant.get(v.id) ?? 0,
          opened: openedByVariant.get(v.id)?.size ?? 0,
          clicked: clickedByVariant.get(v.id)?.size ?? 0,
          replied: repliedByVariant.get(v.id)?.size ?? 0,
          bounced: bouncedByVariant.get(v.id)?.size ?? 0,
        }),
      );

      analytics.push({
        step_id: step.id,
        step_order: step.step_order,
        type: step.type,
        subject: step.subject_override || `Step ${step.step_order + 1}`,
        sent,
        opened,
        clicked,
        replied,
        bounced,
        unsubscribed,
        variants: variantAnalytics,
      });
    }

    setStepAnalytics(analytics);
    setLoading(false);
  }, [workspaceId, sequenceId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (stepAnalytics.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        No email steps with analytics data yet.
      </div>
    );
  }

  // Best step: highest reply rate among steps with sent >= 5
  const eligibleSteps = stepAnalytics.filter((s) => s.sent >= 5);
  let bestStepOrder: number | null = null;
  if (eligibleSteps.length > 0) {
    const best = eligibleSteps.reduce((a, b) =>
      pct(a.replied, a.sent) >= pct(b.replied, b.sent) ? a : b
    );
    bestStepOrder = best.step_order;
  }

  // Rate-based chart data
  const chartData = stepAnalytics.map((s) => ({
    name: `Step ${s.step_order + 1}`,
    "Open %": pct(s.opened, s.sent),
    "Click %": pct(s.clicked, s.sent),
    "Reply %": pct(s.replied, s.sent),
  }));

  // Funnel: only show if >= 2 email steps
  const showFunnel = stepAnalytics.length >= 2;

  return (
    <div className="space-y-6">
      {/* Funnel Drop-off Panel */}
      {showFunnel && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-medium text-slate-900 mb-4">Step Drop-off Funnel</h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {stepAnalytics.map((step, idx) => {
              const dropPct =
                idx > 0 && stepAnalytics[idx - 1].sent > 0
                  ? Math.round(
                      ((stepAnalytics[idx - 1].sent - step.sent) /
                        stepAnalytics[idx - 1].sent) *
                        100
                    )
                  : null;

              return (
                <div key={step.step_order} className="flex items-center gap-2 flex-shrink-0">
                  {idx > 0 && (
                    <div className="flex flex-col items-center gap-0.5 text-slate-400">
                      <span className="text-xs font-medium text-orange-500">
                        {dropPct !== null ? `-${dropPct}%` : ""}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  )}
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 min-w-[130px]">
                    <div className="text-xs font-semibold text-slate-700 mb-1">
                      Step {step.step_order + 1}
                    </div>
                    <div className="text-xs text-slate-500 truncate max-w-[120px] mb-2" title={step.subject}>
                      {step.subject.length > 30 ? step.subject.slice(0, 30) + "…" : step.subject}
                    </div>
                    <div className="text-sm font-bold text-slate-900">{step.sent} sent</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {pct(step.opened, step.sent)}% open · {pct(step.replied, step.sent)}% reply
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rate-based Bar Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-medium text-slate-900 mb-4">Engagement Rates by Step</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" domain={[0, 100]} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              <Bar dataKey="Open %" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Click %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Reply %" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-step Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Step</th>
              <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Subject</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Sent</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Open %</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Click %</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Reply %</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Bounce %</th>
              <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Unsub %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {stepAnalytics.map((s) => {
              const isExpanded = expandedSteps.has(s.step_id);
              const hasVariants = s.variants.length > 0;
              const variantWinnerId = hasVariants
                ? s.variants
                    .filter((v) => v.sent >= 20)
                    .reduce<{ id: string; rate: number } | null>((best, v) => {
                      const rate = v.replied / Math.max(1, v.sent);
                      return best === null || rate > best.rate
                        ? { id: v.id, rate }
                        : best;
                    }, null)?.id ?? null
                : null;
              return (
                <>
                  <tr key={s.step_order} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      <div className="flex items-center gap-1">
                        {hasVariants && (
                          <button
                            type="button"
                            onClick={() => toggleStepExpansion(s.step_id)}
                            className="text-slate-400 hover:text-slate-700"
                            title={isExpanded ? "Collapse variants" : "Expand variants"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                        Step {s.step_order + 1}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.subject}
                        {bestStepOrder === s.step_order && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 whitespace-nowrap">
                            ⭐ Most replies
                          </span>
                        )}
                        {hasVariants && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
                            {s.variants.length} variant{s.variants.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {hasVariants && s.variants.filter((v) => v.sent >= 20).length >= 2 && (
                          <button
                            type="button"
                            onClick={() => promoteWinner(s)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded"
                            title="Set the highest-reply-rate variant to weight 5; others to weight 1"
                          >
                            <Trophy className="w-3 h-3" />
                            Promote winner
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{s.sent}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.opened, s.sent)}%</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.clicked, s.sent)}%</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.replied, s.sent)}%</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.bounced, s.sent)}%</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.unsubscribed, s.sent)}%</td>
                  </tr>
                  {isExpanded &&
                    s.variants.map((v) => (
                      <tr
                        key={`${s.step_id}-${v.id}`}
                        className="bg-slate-50/60 hover:bg-slate-100/60"
                      >
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 text-xs text-slate-700 pl-8">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={v.is_active ? "" : "italic text-slate-400"}>
                              ↳ {v.name}
                            </span>
                            <span className="text-slate-400">
                              weight {v.weight}
                              {!v.is_active && " · disabled"}
                            </span>
                            {variantWinnerId === v.id && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                                <Trophy className="w-3 h-3" />
                                Leader
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-slate-600">{v.sent}</td>
                        <td className="px-4 py-2 text-center text-xs text-slate-600">{pct(v.opened, v.sent)}%</td>
                        <td className="px-4 py-2 text-center text-xs text-slate-600">{pct(v.clicked, v.sent)}%</td>
                        <td className="px-4 py-2 text-center text-xs text-slate-600">{pct(v.replied, v.sent)}%</td>
                        <td className="px-4 py-2 text-center text-xs text-slate-600">{pct(v.bounced, v.sent)}%</td>
                        <td className="px-4 py-2 text-center text-xs text-slate-400">—</td>
                      </tr>
                    ))}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
