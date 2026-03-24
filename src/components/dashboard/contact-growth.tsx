"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Users } from "lucide-react";
import Link from "next/link";

interface ContactGrowthPoint {
  date: string;
  total: number;
}

interface LeadStatusBreakdown {
  new: number;
  contacted: number;
  qualified: number;
  customer: number;
  churned: number;
}

interface ContactGrowthProps {
  growthChart: ContactGrowthPoint[];
  leadStatus: LeadStatusBreakdown;
}

const statusConfig: { key: keyof LeadStatusBreakdown; label: string; color: string }[] = [
  { key: "new", label: "New", color: "#6366f1" },
  { key: "contacted", label: "Contacted", color: "#f59e0b" },
  { key: "qualified", label: "Qualified", color: "#3b82f6" },
  { key: "customer", label: "Customer", color: "#22c55e" },
  { key: "churned", label: "Churned", color: "#ef4444" },
];

export function ContactGrowth({ growthChart, leadStatus }: ContactGrowthProps) {
  const totalLeads = Object.values(leadStatus).reduce((a, b) => a + b, 0);

  if (totalLeads === 0 && growthChart.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Contact Growth</h2>
        <div className="text-center py-12">
          <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-2">No contacts yet</p>
          <Link href="/contacts" className="text-sm text-indigo-600 hover:text-indigo-700">
            Import contacts to get started
          </Link>
        </div>
      </div>
    );
  }

  const pieData = statusConfig
    .filter((s) => leadStatus[s.key] > 0)
    .map((s) => ({
      name: s.label,
      value: leadStatus[s.key],
      color: s.color,
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Growth chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Contact Growth</h2>
        {growthChart.length > 0 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  name="Contacts"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-8">Not enough data for chart</p>
        )}
      </div>

      {/* Lead status breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Lead Status Breakdown</h2>
        <div className="flex items-center gap-6">
          <div className="w-40 h-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={65}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-2">
            {statusConfig.map((s) => {
              const count = leadStatus[s.key];
              const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
              return (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-slate-600">{s.label}</span>
                  </div>
                  <span className="text-slate-900 font-medium">
                    {count} <span className="text-slate-400 font-normal">({pct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
