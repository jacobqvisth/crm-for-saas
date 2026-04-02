"use client";

import { useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { createClient } from "@/lib/supabase/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Shield } from "lucide-react";
import { format } from "date-fns";
import type { SendVolumeEntry } from "@/app/api/analytics/send-volume/route";
import type { Tables } from "@/lib/database.types";

type GmailAccount = Tables<"gmail_accounts">;

interface SenderStats {
  accountId: string;
  bounced: number;
  sent: number;
}

interface SuppressionCount {
  reason: string;
  count: number;
}

export function DeliverabilityPanel() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [volumeData, setVolumeData] = useState<SendVolumeEntry[]>([]);
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [senderStats, setSenderStats] = useState<Map<string, SenderStats>>(new Map());
  const [suppressions, setSuppressions] = useState<SuppressionCount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    try {
      // 1. Fetch send volume
      const volRes = await fetch("/api/analytics/send-volume");
      if (volRes.ok) {
        const data: SendVolumeEntry[] = await volRes.json();
        setVolumeData(data);
      }

      // 2. Fetch Gmail accounts
      const { data: gmailAccounts } = await supabase
        .from("gmail_accounts")
        .select("*")
        .eq("workspace_id", workspaceId);
      setAccounts(gmailAccounts || []);

      if (gmailAccounts && gmailAccounts.length > 0) {
        const accountIds = gmailAccounts.map((a) => a.id);

        // 3. Fetch sent emails in last 7 days per sender
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: recentQueue } = await supabase
          .from("email_queue")
          .select("id, tracking_id, sender_account_id, status")
          .eq("workspace_id", workspaceId)
          .eq("status", "sent")
          .in("sender_account_id", accountIds)
          .gte("sent_at", sevenDaysAgo.toISOString());

        if (recentQueue && recentQueue.length > 0) {
          const trackingIds = recentQueue.map((q) => q.tracking_id).filter(Boolean);

          const { data: bounceEvents } = await supabase
            .from("email_events")
            .select("tracking_id")
            .in("tracking_id", trackingIds)
            .eq("event_type", "bounce");

          const bounceTrackingIds = new Set((bounceEvents || []).map((e) => e.tracking_id));

          // Aggregate by sender_account_id
          const statsMap = new Map<string, SenderStats>();
          for (const q of recentQueue) {
            if (!statsMap.has(q.sender_account_id)) {
              statsMap.set(q.sender_account_id, { accountId: q.sender_account_id, sent: 0, bounced: 0 });
            }
            const s = statsMap.get(q.sender_account_id)!;
            s.sent += 1;
            if (bounceTrackingIds.has(q.tracking_id)) s.bounced += 1;
          }
          setSenderStats(statsMap);
        }
      }

      // 4. Fetch suppression counts
      const { data: suppressionRows } = await supabase
        .from("suppressions")
        .select("reason")
        .eq("workspace_id", workspaceId)
        .eq("active", true);

      if (suppressionRows) {
        const counts = new Map<string, number>();
        for (const row of suppressionRows) {
          counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
        }
        setSuppressions(Array.from(counts.entries()).map(([reason, count]) => ({ reason, count })));
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const totalSuppressed = suppressions.reduce((acc, s) => acc + s.count, 0);
  const getSupCount = (reason: string) =>
    suppressions.find((s) => s.reason === reason)?.count ?? 0;

  const formatDate = (label: unknown) => {
    const dateStr = String(label ?? "");
    try {
      return format(new Date(dateStr), "MMM d");
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (account: GmailAccount) => {
    if (account.status === "error") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          Auth error
        </span>
      );
    }
    if (account.status === "paused") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
          Paused
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        Active
      </span>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-900">Deliverability</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Shield className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-slate-900">Deliverability</h2>
      </div>

      {/* Daily Send Volume Chart */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-slate-700 mb-3">Daily Send Volume (last 30 days)</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={volumeData}>
              <defs>
                <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="repliedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bouncedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={formatDate}
                interval={4}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={formatDate} />
              <Legend />
              <Area
                type="monotone"
                dataKey="sent"
                name="Sent"
                stroke="#6366f1"
                fill="url(#sentGrad)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="replied"
                name="Replied"
                stroke="#22c55e"
                fill="url(#repliedGrad)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="bounced"
                name="Bounced"
                stroke="#ef4444"
                fill="url(#bouncedGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sender Account Health Table */}
      {accounts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Sender Account Health</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-2">Account</th>
                  <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-2">Health</th>
                  <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-2">Warmup</th>
                  <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-2">Capacity</th>
                  <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => {
                  const stats = senderStats.get(account.id);
                  const bounceRate =
                    stats && stats.sent > 0
                      ? ((stats.bounced / stats.sent) * 100).toFixed(1)
                      : "0.0";
                  const healthScore = (account as { health_score?: number }).health_score ?? 50;
                  const warmupStage = (account as { warmup_stage?: string }).warmup_stage ?? "ramp";
                  const warmupDay = (account as { warmup_day?: number }).warmup_day ?? 0;
                  const healthColor =
                    healthScore >= 80
                      ? "bg-green-100 text-green-700"
                      : healthScore >= 50
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-red-100 text-red-700";
                  const remaining = Math.max(0, account.max_daily_sends - account.daily_sends_count);

                  return (
                    <tr key={account.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div>
                          <span className="text-sm text-slate-900">{account.email_address}</span>
                          {account.pause_reason && (
                            <p className="text-xs text-slate-500 mt-0.5">{account.pause_reason}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          title={`Bounce rate (7d): ${bounceRate}%`}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${healthColor}`}
                        >
                          {healthScore}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {warmupStage === "graduated" ? (
                          <span className="text-xs text-green-700">✅ Done</span>
                        ) : warmupStage === "ramp" ? (
                          <span className="text-xs text-indigo-700">Day {warmupDay}/21</span>
                        ) : (
                          <span className="text-xs text-slate-500">Manual</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-sm text-slate-600">
                        {remaining}/{account.max_daily_sends}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {getStatusBadge(account)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suppression Stats */}
      {totalSuppressed > 0 && (
        <div className="text-sm text-slate-500">
          Total suppressed:{" "}
          <span className="font-medium text-slate-700">{totalSuppressed}</span>
          {" ("}
          {getSupCount("bounce") > 0 && (
            <span>{getSupCount("bounce")} bounced</span>
          )}
          {getSupCount("bounce") > 0 && getSupCount("unsubscribe") > 0 && " · "}
          {getSupCount("unsubscribe") > 0 && (
            <span>{getSupCount("unsubscribe")} unsubscribed</span>
          )}
          {(getSupCount("bounce") > 0 || getSupCount("unsubscribe") > 0) &&
            suppressions.filter(
              (s) => s.reason !== "bounce" && s.reason !== "unsubscribe"
            ).length > 0 &&
            " · "}
          {suppressions
            .filter((s) => s.reason !== "bounce" && s.reason !== "unsubscribe")
            .reduce((acc, s) => acc + s.count, 0) > 0 && (
            <span>
              {suppressions
                .filter((s) => s.reason !== "bounce" && s.reason !== "unsubscribe")
                .reduce((acc, s) => acc + s.count, 0)}{" "}
              manual/DNC
            </span>
          )}
          {")"}
        </div>
      )}
    </div>
  );
}
