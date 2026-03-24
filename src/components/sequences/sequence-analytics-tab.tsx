"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface StepAnalytics {
  step_order: number;
  type: string;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

interface SequenceAnalyticsTabProps {
  sequenceId: string;
}

export function SequenceAnalyticsTab({ sequenceId }: SequenceAnalyticsTabProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [stepAnalytics, setStepAnalytics] = useState<StepAnalytics[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    // Get steps
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

    for (const step of steps) {
      if (step.type !== "email") continue;

      // Get email queue entries for this step
      const { data: queueItems } = await supabase
        .from("email_queue")
        .select("id, tracking_id, status")
        .eq("step_id", step.id)
        .eq("workspace_id", workspaceId);

      const sent = (queueItems || []).filter((q) => q.status === "sent").length;
      const trackingIds = (queueItems || []).map((q) => q.tracking_id).filter(Boolean);

      let opened = 0;
      let clicked = 0;
      let replied = 0;

      if (trackingIds.length > 0) {
        const { data: events } = await supabase
          .from("email_events")
          .select("event_type, tracking_id")
          .in("tracking_id", trackingIds);

        if (events) {
          const uniqueOpened = new Set<string>();
          const uniqueClicked = new Set<string>();
          const uniqueReplied = new Set<string>();

          for (const ev of events) {
            if (ev.event_type === "open") uniqueOpened.add(ev.tracking_id);
            if (ev.event_type === "click") uniqueClicked.add(ev.tracking_id);
            if (ev.event_type === "reply") uniqueReplied.add(ev.tracking_id);
          }

          opened = uniqueOpened.size;
          clicked = uniqueClicked.size;
          replied = uniqueReplied.size;
        }
      }

      analytics.push({
        step_order: step.step_order,
        type: step.type,
        subject: step.subject_override || `Step ${step.step_order + 1}`,
        sent,
        opened,
        clicked,
        replied,
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

  const chartData = stepAnalytics.map((s) => ({
    name: `Step ${s.step_order + 1}`,
    Sent: s.sent,
    Opened: s.opened,
    Clicked: s.clicked,
    Replied: s.replied,
  }));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-sm font-medium text-slate-900 mb-4">Funnel Overview</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="Sent" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Opened" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Clicked" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Replied" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {stepAnalytics.map((s) => (
              <tr key={s.step_order} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">Step {s.step_order + 1}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{s.subject}</td>
                <td className="px-4 py-3 text-center text-sm text-slate-600">{s.sent}</td>
                <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.opened, s.sent)}%</td>
                <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.clicked, s.sent)}%</td>
                <td className="px-4 py-3 text-center text-sm text-slate-600">{pct(s.replied, s.sent)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
