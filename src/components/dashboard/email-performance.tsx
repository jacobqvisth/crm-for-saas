"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Send,
  Eye,
  MousePointerClick,
  MessageSquare,
  AlertTriangle,
  UserMinus,
  Mail,
} from "lucide-react";
import Link from "next/link";
import { InfoTooltip } from "@/components/info-tooltip";

const STAT_HELP: Record<string, string> = {
  Sent: "Number of sequence emails successfully handed off to Gmail in the selected period. Excludes scheduled, paused, cancelled, or failed sends.",
  Opened:
    "Unique emails whose tracking pixel was loaded. Known bots and scanners (Google Image Proxy, etc.) are filtered out. Multiple opens of the same email count once per hour.",
  Clicked:
    "Unique emails where the recipient clicked at least one tracked link.",
  Replied:
    "Real replies only. Out-of-office and other auto-replies are detected via headers and subject patterns and excluded from this count — they still show up in Inbox flagged as 'Out of office'.",
  Bounced:
    "Permanent (5xx) bounces detected from non-delivery reports in the sender's inbox. Soft (4xx) bounces are retried instead.",
  Unsubscribes:
    "Recipients who clicked the unsubscribe link or were added to the suppression list. They will not receive further sequence emails.",
};

interface EmailStats {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribes: number;
}

interface EmailVolumePoint {
  date: string;
  sent: number;
  opened: number;
}

interface EmailPerformanceProps {
  stats: EmailStats;
  volumeChart: EmailVolumePoint[];
}

function StatCard({
  icon: Icon,
  label,
  count,
  percentage,
}: {
  icon: typeof Send;
  label: string;
  count: number;
  percentage: string | null;
}) {
  const help = STAT_HELP[label];
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{count.toLocaleString()}</p>
        <p className="text-xs text-slate-500 truncate flex items-center gap-1">
          <span className="truncate">
            {label}
            {percentage && <span className="text-slate-400"> ({percentage})</span>}
          </span>
          {help && <InfoTooltip label={help} />}
        </p>
      </div>
    </div>
  );
}

export function EmailPerformance({ stats, volumeChart }: EmailPerformanceProps) {
  const pct = (n: number) =>
    stats.sent > 0 ? `${Math.round((n / stats.sent) * 100)}%` : "0%";

  if (stats.sent === 0 && volumeChart.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Email Performance</h2>
        <div className="text-center py-12">
          <Mail className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-2">No emails sent yet</p>
          <Link href="/sequences" className="text-sm text-indigo-600 hover:text-indigo-700">
            Connect a Gmail account and start a sequence to see email metrics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Email Performance</h2>

      {volumeChart.length > 0 && (
        <div className="h-64 mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={volumeChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  fontSize: "13px",
                }}
              />
              <Area
                type="monotone"
                dataKey="sent"
                stroke="#6366f1"
                fill="url(#sentGradient)"
                strokeWidth={2}
                name="Sent"
              />
              <Area
                type="monotone"
                dataKey="opened"
                stroke="#22c55e"
                fill="url(#openedGradient)"
                strokeWidth={2}
                name="Opened"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Send} label="Sent" count={stats.sent} percentage={null} />
        <StatCard icon={Eye} label="Opened" count={stats.opened} percentage={pct(stats.opened)} />
        <StatCard
          icon={MousePointerClick}
          label="Clicked"
          count={stats.clicked}
          percentage={pct(stats.clicked)}
        />
        <StatCard
          icon={MessageSquare}
          label="Replied"
          count={stats.replied}
          percentage={pct(stats.replied)}
        />
        <StatCard
          icon={AlertTriangle}
          label="Bounced"
          count={stats.bounced}
          percentage={pct(stats.bounced)}
        />
        <StatCard
          icon={UserMinus}
          label="Unsubscribes"
          count={stats.unsubscribes}
          percentage={pct(stats.unsubscribes)}
        />
      </div>
    </div>
  );
}
