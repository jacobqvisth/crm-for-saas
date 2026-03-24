"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Users,
  Mail,
  Send,
  Eye,
  MessageSquare,
  DollarSign,
} from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { MetricCard } from "@/components/metric-card";
import { ActivityFeed } from "@/components/activity-feed";
import { DateRangeSelector, type RangeKey } from "./date-range-selector";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { EmailPerformance } from "./email-performance";
import { SequencePerformance } from "./sequence-performance";
import { PipelineSection } from "./pipeline-section";
import { ContactGrowth } from "./contact-growth";
import type { Tables } from "@/lib/database.types";

interface DashboardData {
  metrics: {
    totalContacts: number;
    contactsInPeriod: number;
    contactsTrend: number;
    activeSequences: number;
    emailsSentCount: number;
    emailsTrend: number;
    openRate: number;
    openRateTrend: number;
    replyRate: number;
    replyRateTrend: number;
    pipelineValue: number;
  };
  emailStats: {
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribes: number;
  };
  emailVolumeChart: { date: string; sent: number; opened: number }[];
  pipelineChartData: { name: string; count: number; value: number; color: string }[];
  dealsClosingSoon: {
    id: string;
    name: string;
    amount: number | null;
    stage: string;
    expected_close_date: string | null;
    companyName: string | null;
  }[];
  wonLost: {
    wonCount: number;
    wonValue: number;
    lostCount: number;
    lostValue: number;
    winRate: number;
  };
  contactGrowthChart: { date: string; total: number }[];
  leadStatusBreakdown: {
    new: number;
    contacted: number;
    qualified: number;
    customer: number;
    churned: number;
  };
  sequencePerformance: {
    id: string;
    name: string;
    status: string;
    enrolled: number;
    active: number;
    replied: number;
    completed: number;
    replyRate: number;
  }[];
  activities: Tables<"activities">[];
}

function formatCurrency(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

export function DashboardClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const range = (searchParams.get("range") as RangeKey) || "30d";

  const handleRangeChange = useCallback(
    (newRange: RangeKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("range", newRange);
      router.push(`/dashboard?${params.toString()}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (wsLoading) return;
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        // Use the Supabase client to get the session cookie, then call API
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          toast.error("Not authenticated");
          return;
        }

        const res = await fetch(`/api/dashboard?range=${range}`);
        if (!res.ok) {
          throw new Error("Failed to fetch dashboard data");
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch {
        if (!cancelled) {
          toast.error("Failed to load dashboard data");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [range, workspaceId, wsLoading]);

  if (wsLoading || loading || !data) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
            <p className="text-slate-500 mt-1">Overview of your CRM performance</p>
          </div>
          <DateRangeSelector value={range} onChange={handleRangeChange} />
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  const { metrics } = data;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 mt-1">Overview of your CRM performance</p>
        </div>
        <DateRangeSelector value={range} onChange={handleRangeChange} />
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Total Contacts"
          value={metrics.totalContacts.toLocaleString()}
          icon={Users}
          subtitle={`+${metrics.contactsInPeriod} this period`}
          trend={
            metrics.contactsTrend !== 0
              ? { value: Math.abs(metrics.contactsTrend), positive: metrics.contactsTrend > 0 }
              : undefined
          }
        />
        <MetricCard
          title="Active Sequences"
          value={metrics.activeSequences}
          icon={Mail}
        />
        <MetricCard
          title="Emails Sent"
          value={metrics.emailsSentCount.toLocaleString()}
          icon={Send}
          subtitle="in selected period"
          trend={
            metrics.emailsTrend !== 0
              ? { value: Math.abs(metrics.emailsTrend), positive: metrics.emailsTrend > 0 }
              : undefined
          }
        />
        <MetricCard
          title="Open Rate"
          value={`${metrics.openRate}%`}
          icon={Eye}
          subtitle="in selected period"
          trend={
            metrics.openRateTrend !== 0
              ? { value: Math.abs(metrics.openRateTrend), positive: metrics.openRateTrend > 0 }
              : undefined
          }
        />
        <MetricCard
          title="Reply Rate"
          value={`${metrics.replyRate}%`}
          icon={MessageSquare}
          subtitle="in selected period"
          trend={
            metrics.replyRateTrend !== 0
              ? { value: Math.abs(metrics.replyRateTrend), positive: metrics.replyRateTrend > 0 }
              : undefined
          }
        />
        <MetricCard
          title="Pipeline Value"
          value={formatCurrency(metrics.pipelineValue)}
          icon={DollarSign}
          subtitle="open deals"
        />
      </div>

      {/* Email Performance */}
      <div className="mb-8">
        <EmailPerformance stats={data.emailStats} volumeChart={data.emailVolumeChart} />
      </div>

      {/* Sequence Performance */}
      <div className="mb-8">
        <SequencePerformance sequences={data.sequencePerformance} />
      </div>

      {/* Pipeline & Deals */}
      <div className="mb-8">
        <PipelineSection
          chartData={data.pipelineChartData}
          dealsClosingSoon={data.dealsClosingSoon}
          wonLost={data.wonLost}
        />
      </div>

      {/* Contact Growth */}
      <div className="mb-8">
        <ContactGrowth
          growthChart={data.contactGrowthChart}
          leadStatus={data.leadStatusBreakdown}
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent Activity</h2>
        <ActivityFeed activities={data.activities} showFilters />
      </div>
    </div>
  );
}
