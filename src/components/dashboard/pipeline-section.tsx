"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { DollarSign, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

interface PipelineChartItem {
  name: string;
  count: number;
  value: number;
  color: string;
}

interface DealClosingSoon {
  id: string;
  name: string;
  amount: number | null;
  stage: string;
  expected_close_date: string | null;
  companyName: string | null;
}

interface WonLost {
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  winRate: number;
}

interface PipelineSectionProps {
  chartData: PipelineChartItem[];
  dealsClosingSoon: DealClosingSoon[];
  wonLost: WonLost;
}

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

export function PipelineSection({ chartData, dealsClosingSoon, wonLost }: PipelineSectionProps) {
  const hasData = chartData.length > 0 || dealsClosingSoon.length > 0;

  if (!hasData && wonLost.wonCount === 0 && wonLost.lostCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Pipeline & Deals</h2>
        <div className="text-center py-12">
          <DollarSign className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-2">No deals yet</p>
          <Link href="/deals" className="text-sm text-indigo-600 hover:text-indigo-700">
            Create your first deal to see pipeline analytics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pipeline chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Pipeline Overview</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatCurrency(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                  formatter={(value, name) =>
                    name === "Value" ? formatCurrency(Number(value)) : value
                  }
                />
                <Legend />
                <Bar yAxisId="left" dataKey="count" name="Deals" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
                <Bar
                  yAxisId="right"
                  dataKey="value"
                  name="Value"
                  radius={[4, 4, 0, 0]}
                  opacity={0.4}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Won/Lost + Deals closing soon */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Won/Lost summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-slate-500">Closed Won</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {formatCurrency(wonLost.wonValue)}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {wonLost.wonCount} deal{wonLost.wonCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium text-slate-500">Closed Lost</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {formatCurrency(wonLost.lostValue)}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {wonLost.lostCount} deal{wonLost.lostCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="col-span-2 bg-white rounded-xl border border-slate-200 p-5">
            <span className="text-sm font-medium text-slate-500">Win Rate</span>
            <div className="flex items-end gap-2 mt-1">
              <p className="text-2xl font-semibold text-slate-900">{wonLost.winRate}%</p>
              <p className="text-xs text-slate-400 pb-1">
                ({wonLost.wonCount}W / {wonLost.lostCount}L)
              </p>
            </div>
          </div>
        </div>

        {/* Deals closing soon */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              Deals Closing Soon
            </h3>
            <Link href="/deals" className="text-xs text-indigo-600 hover:text-indigo-700">
              View all deals &rarr;
            </Link>
          </div>
          {dealsClosingSoon.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              No deals closing in the next 30 days
            </p>
          ) : (
            <div className="space-y-2">
              {dealsClosingSoon.map((deal) => (
                <div
                  key={deal.id}
                  className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 truncate">{deal.name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {deal.companyName ?? "No company"} &middot; {deal.stage}
                    </p>
                  </div>
                  <div className="text-right ml-3 shrink-0">
                    <p className="text-sm font-medium text-slate-900">
                      {deal.amount ? formatCurrency(deal.amount) : "-"}
                    </p>
                    {deal.expected_close_date && (
                      <p className="text-xs text-slate-400">
                        {format(new Date(deal.expected_close_date), "MMM d")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
