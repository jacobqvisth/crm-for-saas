import {
  Users,
  Mail,
  Send,
  Eye,
  MessageSquare,
  DollarSign,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MetricCard } from "@/components/metric-card";
import { ActivityFeed } from "@/components/activity-feed";
import { PipelineChart } from "./pipeline-chart";

export default async function DashboardPage() {
  const supabase = await createClient();

  // Fetch all metrics in parallel
  const [
    contactsResult,
    sequencesResult,
    emailsSentResult,
    emailEventsResult,
    activitiesResult,
    pipelinesResult,
    dealsResult,
  ] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase
      .from("sequences")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", new Date().toISOString().split("T")[0]),
    supabase
      .from("email_events")
      .select("event_type")
      .gte(
        "created_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      ),
    supabase
      .from("activities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("pipelines").select("*").limit(1),
    supabase.from("deals").select("stage, amount"),
  ]);

  const totalContacts = contactsResult.count ?? 0;
  const activeSequences = sequencesResult.count ?? 0;
  const emailsSentToday = emailsSentResult.count ?? 0;

  // Calculate open and reply rates
  const events = emailEventsResult.data ?? [];
  const opens = events.filter((e) => e.event_type === "open").length;
  const replies = events.filter((e) => e.event_type === "reply").length;
  const totalEvents = events.length || 1;
  const openRate = totalEvents > 0 ? Math.round((opens / totalEvents) * 100) : 0;
  const replyRate =
    totalEvents > 0 ? Math.round((replies / totalEvents) * 100) : 0;

  // Pipeline value
  const deals = dealsResult.data ?? [];
  const pipelineValue = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  // Deal counts per stage for chart
  const pipeline = pipelinesResult.data?.[0];
  const stages = (pipeline?.stages as Array<{ name: string; order: number; color: string }>) ?? [];
  const dealsByStage = stages.map((stage) => ({
    name: stage.name,
    count: deals.filter((d) => d.stage === stage.name).length,
    color: stage.color,
  }));

  const activities = activitiesResult.data ?? [];

  const formatCurrency = (value: number) => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${value}`;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Overview of your CRM performance
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <MetricCard
          title="Total Contacts"
          value={totalContacts.toLocaleString()}
          icon={Users}
        />
        <MetricCard
          title="Active Sequences"
          value={activeSequences}
          icon={Mail}
        />
        <MetricCard
          title="Emails Sent Today"
          value={emailsSentToday}
          icon={Send}
        />
        <MetricCard
          title="Open Rate (7d)"
          value={`${openRate}%`}
          icon={Eye}
        />
        <MetricCard
          title="Reply Rate (7d)"
          value={`${replyRate}%`}
          icon={MessageSquare}
        />
        <MetricCard
          title="Pipeline Value"
          value={formatCurrency(pipelineValue)}
          icon={DollarSign}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Recent Activity
          </h2>
          <ActivityFeed activities={activities} />
        </div>

        {/* Pipeline Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Pipeline Summary
          </h2>
          {dealsByStage.length > 0 ? (
            <PipelineChart data={dealsByStage} />
          ) : (
            <div className="text-center py-8">
              <DollarSign className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                No pipeline data yet
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
