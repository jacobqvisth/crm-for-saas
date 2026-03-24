import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PipelineStage } from "@/lib/database.types";

type RangeKey = "1d" | "7d" | "30d" | "90d" | "all";

function getRangeDates(range: RangeKey): { start: Date; prevStart: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  const prevStart = new Date();

  if (range === "all") {
    start.setFullYear(2000);
    prevStart.setFullYear(1970);
  } else {
    const days = range === "1d" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
    start.setDate(start.getDate() - days);
    prevStart.setDate(prevStart.getDate() - days * 2);
  }

  return { start, prevStart, end };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get workspace
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceId = memberships[0].workspace_id;
  const range = (request.nextUrl.searchParams.get("range") || "30d") as RangeKey;
  const { start, prevStart, end } = getRangeDates(range);
  const startISO = start.toISOString();
  const prevStartISO = prevStart.toISOString();
  const endISO = end.toISOString();

  // Fetch all data in parallel
  const [
    contactsTotalResult,
    contactsInPeriodResult,
    contactsInPrevPeriodResult,
    contactsAllResult,
    sequencesResult,
    emailsSentResult,
    emailsSentPrevResult,
    emailEventsResult,
    emailEventsPrevResult,
    pipelinesResult,
    dealsResult,
    dealsClosingSoonResult,
    dealsWonResult,
    dealsLostResult,
    dealsWonPrevResult,
    dealsLostPrevResult,
    activitiesResult,
    sequenceEnrollmentsResult,
    unsubscribesResult,
  ] = await Promise.all([
    // Total contacts
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    // Contacts created in period
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    // Contacts created in previous period
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", prevStartISO)
      .lt("created_at", startISO),
    // All contacts with created_at for growth chart
    supabase
      .from("contacts")
      .select("created_at, lead_status")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    // Active sequences
    supabase
      .from("sequences")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    // Emails sent in period
    supabase
      .from("email_queue")
      .select("sent_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("sent_at", startISO)
      .lte("sent_at", endISO),
    // Emails sent in prev period
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("sent_at", prevStartISO)
      .lt("sent_at", startISO),
    // Email events in period
    supabase
      .from("email_events")
      .select("event_type, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    // Email events in prev period
    supabase
      .from("email_events")
      .select("event_type")
      .gte("created_at", prevStartISO)
      .lt("created_at", startISO),
    // Pipelines
    supabase
      .from("pipelines")
      .select("*")
      .eq("workspace_id", workspaceId)
      .limit(1),
    // All deals
    supabase
      .from("deals")
      .select("id, name, amount, stage, probability, company_id, expected_close_date, created_at")
      .eq("workspace_id", workspaceId),
    // Deals closing in next 30 days
    supabase
      .from("deals")
      .select("id, name, amount, stage, expected_close_date, company_id")
      .eq("workspace_id", workspaceId)
      .not("stage", "in", '("Closed Won","Closed Lost")')
      .gte("expected_close_date", new Date().toISOString().split("T")[0])
      .lte(
        "expected_close_date",
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      )
      .order("expected_close_date", { ascending: true })
      .limit(10),
    // Deals won in period
    supabase
      .from("deals")
      .select("id, amount")
      .eq("workspace_id", workspaceId)
      .eq("stage", "Closed Won")
      .gte("updated_at", startISO),
    // Deals lost in period
    supabase
      .from("deals")
      .select("id, amount")
      .eq("workspace_id", workspaceId)
      .eq("stage", "Closed Lost")
      .gte("updated_at", startISO),
    // Deals won in prev period
    supabase
      .from("deals")
      .select("id, amount")
      .eq("workspace_id", workspaceId)
      .eq("stage", "Closed Won")
      .gte("updated_at", prevStartISO)
      .lt("updated_at", startISO),
    // Deals lost in prev period
    supabase
      .from("deals")
      .select("id, amount")
      .eq("workspace_id", workspaceId)
      .eq("stage", "Closed Lost")
      .gte("updated_at", prevStartISO)
      .lt("updated_at", startISO),
    // Activities
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    // Sequence enrollments with sequence info
    supabase
      .from("sequence_enrollments")
      .select("id, sequence_id, status, enrolled_at, completed_at")
      .eq("workspace_id", workspaceId),
    // Unsubscribes in period
    supabase
      .from("unsubscribes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", startISO),
  ]);

  // Sequences with enrollments for the table
  const { data: sequencesForTable } = await supabase
    .from("sequences")
    .select("id, name, status")
    .eq("workspace_id", workspaceId);

  // Company names for deals closing soon
  const companyIds = (dealsClosingSoonResult.data ?? [])
    .map((d) => d.company_id)
    .filter(Boolean) as string[];

  let companiesMap: Record<string, string> = {};
  if (companyIds.length > 0) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    companiesMap = (companies ?? []).reduce(
      (acc, c) => ({ ...acc, [c.id]: c.name }),
      {} as Record<string, string>
    );
  }

  // --- Compute metrics ---

  const totalContacts = contactsTotalResult.count ?? 0;
  const contactsInPeriod = contactsInPeriodResult.count ?? 0;
  const contactsInPrevPeriod = contactsInPrevPeriodResult.count ?? 0;

  const activeSequences = sequencesResult.count ?? 0;

  const emailsSent = emailsSentResult.data ?? [];
  const emailsSentCount = emailsSent.length;
  const emailsSentPrevCount = emailsSentPrevResult.count ?? 0;

  const events = emailEventsResult.data ?? [];
  const prevEvents = emailEventsPrevResult.data ?? [];

  const opens = events.filter((e) => e.event_type === "open").length;
  const clicks = events.filter((e) => e.event_type === "click").length;
  const replies = events.filter((e) => e.event_type === "reply").length;
  const bounces = events.filter((e) => e.event_type === "bounce").length;
  const unsubscribesInEvents = events.filter((e) => e.event_type === "unsubscribe").length;

  const openRate = emailsSentCount > 0 ? Math.round((opens / emailsSentCount) * 100) : 0;
  const replyRate = emailsSentCount > 0 ? Math.round((replies / emailsSentCount) * 100) : 0;

  const prevOpens = prevEvents.filter((e) => e.event_type === "open").length;
  const prevReplies = prevEvents.filter((e) => e.event_type === "reply").length;
  const prevOpenRate =
    emailsSentPrevCount > 0 ? Math.round((prevOpens / emailsSentPrevCount) * 100) : 0;
  const prevReplyRate =
    emailsSentPrevCount > 0 ? Math.round((prevReplies / emailsSentPrevCount) * 100) : 0;

  // Pipeline
  const pipeline = pipelinesResult.data?.[0];
  const stages = (pipeline?.stages as PipelineStage[]) ?? [];
  const deals = dealsResult.data ?? [];

  const openDeals = deals.filter(
    (d) => d.stage !== "Closed Won" && d.stage !== "Closed Lost"
  );
  const pipelineValue = openDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  // Pipeline chart data - deal count and value per stage
  const pipelineChartData = stages
    .filter((s) => s.name !== "Closed Won" && s.name !== "Closed Lost")
    .map((stage) => {
      const stageDeals = deals.filter((d) => d.stage === stage.name);
      return {
        name: stage.name,
        count: stageDeals.length,
        value: stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
        color: stage.color,
      };
    });

  // Won / Lost
  const wonDeals = dealsWonResult.data ?? [];
  const lostDeals = dealsLostResult.data ?? [];
  const wonCount = wonDeals.length;
  const lostCount = lostDeals.length;
  const wonValue = wonDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const lostValue = lostDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

  // Deals closing soon with company names
  const dealsClosingSoon = (dealsClosingSoonResult.data ?? []).map((d) => ({
    ...d,
    companyName: d.company_id ? companiesMap[d.company_id] ?? null : null,
  }));

  // Email volume chart data (group by day or week)
  const shouldGroupByWeek = range === "90d";
  const emailVolumeMap = new Map<string, { sent: number; opened: number }>();

  for (const email of emailsSent) {
    if (!email.sent_at) continue;
    const key = getGroupKey(email.sent_at, shouldGroupByWeek);
    const existing = emailVolumeMap.get(key) ?? { sent: 0, opened: 0 };
    existing.sent++;
    emailVolumeMap.set(key, existing);
  }

  for (const event of events) {
    if (event.event_type !== "open") continue;
    const key = getGroupKey(event.created_at, shouldGroupByWeek);
    const existing = emailVolumeMap.get(key) ?? { sent: 0, opened: 0 };
    existing.opened++;
    emailVolumeMap.set(key, existing);
  }

  const emailVolumeChart = Array.from(emailVolumeMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Contact growth chart
  const allContacts = contactsAllResult.data ?? [];
  const contactGrowthMap = new Map<string, number>();
  let cumulative = 0;
  for (const contact of allContacts) {
    const key = getGroupKey(contact.created_at, shouldGroupByWeek);
    cumulative++;
    contactGrowthMap.set(key, cumulative);
  }

  const contactGrowthChart = Array.from(contactGrowthMap.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Lead status breakdown
  const leadStatusCounts: Record<string, number> = {
    new: 0,
    contacted: 0,
    qualified: 0,
    customer: 0,
    churned: 0,
  };
  for (const contact of allContacts) {
    const status = contact.lead_status ?? "new";
    if (status in leadStatusCounts) {
      leadStatusCounts[status]++;
    }
  }

  // Sequence performance table
  const enrollments = sequenceEnrollmentsResult.data ?? [];
  const sequencesList = sequencesForTable ?? [];

  const sequencePerformance = sequencesList
    .map((seq) => {
      const seqEnrollments = enrollments.filter((e) => e.sequence_id === seq.id);
      if (seqEnrollments.length === 0) return null;
      const enrolled = seqEnrollments.length;
      const active = seqEnrollments.filter((e) => e.status === "active").length;
      const replied = seqEnrollments.filter((e) => e.status === "replied").length;
      const completed = seqEnrollments.filter((e) => e.status === "completed").length;
      const replyRatePct = enrolled > 0 ? Math.round((replied / enrolled) * 100) : 0;
      return {
        id: seq.id,
        name: seq.name,
        status: seq.status,
        enrolled,
        active,
        replied,
        completed,
        replyRate: replyRatePct,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b?.replyRate ?? 0) - (a?.replyRate ?? 0));

  // Compute trends
  const contactsTrend =
    contactsInPrevPeriod > 0
      ? Math.round(((contactsInPeriod - contactsInPrevPeriod) / contactsInPrevPeriod) * 100)
      : contactsInPeriod > 0
        ? 100
        : 0;

  const emailsTrend =
    emailsSentPrevCount > 0
      ? Math.round(((emailsSentCount - emailsSentPrevCount) / emailsSentPrevCount) * 100)
      : emailsSentCount > 0
        ? 100
        : 0;

  const openRateTrend = openRate - prevOpenRate;
  const replyRateTrend = replyRate - prevReplyRate;

  return NextResponse.json({
    metrics: {
      totalContacts,
      contactsInPeriod,
      contactsTrend,
      activeSequences,
      emailsSentCount,
      emailsTrend,
      openRate,
      openRateTrend,
      replyRate,
      replyRateTrend,
      pipelineValue,
    },
    emailStats: {
      sent: emailsSentCount,
      opened: opens,
      clicked: clicks,
      replied: replies,
      bounced: bounces,
      unsubscribes: unsubscribesInEvents + (unsubscribesResult.count ?? 0),
    },
    emailVolumeChart,
    pipelineChartData,
    dealsClosingSoon,
    wonLost: {
      wonCount,
      wonValue,
      lostCount,
      lostValue,
      winRate,
    },
    contactGrowthChart,
    leadStatusBreakdown: leadStatusCounts,
    sequencePerformance,
    activities: activitiesResult.data ?? [],
  });
}

function getGroupKey(dateStr: string, byWeek: boolean): string {
  const d = new Date(dateStr);
  if (byWeek) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().split("T")[0];
  }
  return d.toISOString().split("T")[0];
}
