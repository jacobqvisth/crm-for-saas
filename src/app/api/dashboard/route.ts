import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pageAll } from "@/lib/supabase-paging";

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
    // All contacts with created_at for growth chart — paginated; this
    // workspace already has >10k contacts so the unpaginated select silently
    // truncated to the oldest 1000.
    pageAll<{ created_at: string | null; lead_status: string | null }>(
      ({ from, to }) =>
        supabase
          .from("contacts")
          .select("created_at, lead_status")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: true })
          .range(from, to),
    ),
    // Active sequences
    supabase
      .from("sequences")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    // Emails sent in period — paginated so the headline + the date-bucket
    // chart aren't capped at PostgREST's 1000-row ceiling.
    pageAll<{ sent_at: string | null }>(({ from, to }) =>
      supabase
        .from("email_queue")
        .select("sent_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "sent")
        .gte("sent_at", startISO)
        .lte("sent_at", endISO)
        .order("sent_at", { ascending: true })
        .range(from, to),
    ),
    // Emails sent in prev period
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "sent")
      .gte("sent_at", prevStartISO)
      .lt("sent_at", startISO),
    // Email events in period — paginated for the same reason. The event row
    // count grows ~1.5× the sent count (open + reply + click + bounce + unsub)
    // so it hits the 1000 ceiling even earlier than the sent scan.
    pageAll<{ event_type: string; created_at: string | null }>(({ from, to }) =>
      supabase
        .from("email_events")
        .select("event_type, created_at")
        .gte("created_at", startISO)
        .lte("created_at", endISO)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    // Email events in prev period — paginated.
    pageAll<{ event_type: string }>(({ from, to }) =>
      supabase
        .from("email_events")
        .select("event_type, created_at")
        .gte("created_at", prevStartISO)
        .lt("created_at", startISO)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    // Activities
    supabase
      .from("activities")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    // Sequence enrollments with sequence info — paginated. Drives the
    // per-sequence table further down; the workspace already has >10k
    // enrollments and an unpaginated read silently dropped everything past
    // the first 1000.
    pageAll<{
      id: string;
      sequence_id: string | null;
      status: string | null;
      enrolled_at: string | null;
      completed_at: string | null;
    }>(({ from, to }) =>
      supabase
        .from("sequence_enrollments")
        .select("id, sequence_id, status, enrolled_at, completed_at")
        .eq("workspace_id", workspaceId)
        .order("enrolled_at", { ascending: true })
        .range(from, to),
    ),
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

  // Email volume chart data (group by day or week).
  // Pre-seed with every interval in the range so days/weeks with zero
  // sends + zero opens render as zero rows instead of disappearing from
  // the chart entirely. Matches the bucket-by-range pattern fixed across
  // /ceo/* in PRs #205 + #207.
  const shouldGroupByWeek = range === "90d";
  const emailVolumeMap = new Map<string, { sent: number; opened: number }>();
  for (const key of enumerateIntervals(start, end, shouldGroupByWeek)) {
    emailVolumeMap.set(key, { sent: 0, opened: 0 });
  }

  for (const email of emailsSent) {
    if (!email.sent_at) continue;
    const key = getGroupKey(email.sent_at, shouldGroupByWeek);
    const existing = emailVolumeMap.get(key) ?? { sent: 0, opened: 0 };
    existing.sent++;
    emailVolumeMap.set(key, existing);
  }

  for (const event of events) {
    if (event.event_type !== "open") continue;
    if (!event.created_at) continue;
    const key = getGroupKey(event.created_at, shouldGroupByWeek);
    const existing = emailVolumeMap.get(key) ?? { sent: 0, opened: 0 };
    existing.opened++;
    emailVolumeMap.set(key, existing);
  }

  const emailVolumeChart = Array.from(emailVolumeMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Contact growth chart — cumulative count of all contacts. Pre-seed
  // with the running total at each interval boundary so a stretch of
  // days with no new contacts still renders a flat line at the prior
  // total instead of dropping out and creating a visual gap.
  const allContacts = contactsAllResult.data ?? [];
  const sortedContactCreatedAt = allContacts
    .map((c) => c.created_at)
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => a.localeCompare(b));

  const contactGrowthMap = new Map<string, number>();
  const intervalKeys = enumerateIntervals(start, end, shouldGroupByWeek);
  let cursor = 0;
  let running = 0;
  // First, count contacts created BEFORE the range starts so the first
  // bucket includes the prior baseline (otherwise the line resets to 0).
  if (intervalKeys.length > 0) {
    const firstBoundary = new Date(intervalKeys[0]).getTime();
    while (
      cursor < sortedContactCreatedAt.length &&
      new Date(sortedContactCreatedAt[cursor]).getTime() < firstBoundary
    ) {
      running++;
      cursor++;
    }
  }
  for (let i = 0; i < intervalKeys.length; i++) {
    const key = intervalKeys[i];
    const nextBoundary =
      i + 1 < intervalKeys.length
        ? new Date(intervalKeys[i + 1]).getTime()
        : end.getTime() + 1;
    while (
      cursor < sortedContactCreatedAt.length &&
      new Date(sortedContactCreatedAt[cursor]).getTime() < nextBoundary
    ) {
      running++;
      cursor++;
    }
    contactGrowthMap.set(key, running);
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

// Pre-seed every interval boundary between start and end (inclusive).
// Returns the same YYYY-MM-DD string format getGroupKey produces. Capped
// at 400 buckets to keep "90d weekly" + "30d daily" sane and stop a
// misconfigured range from runaway-looping.
function enumerateIntervals(start: Date, end: Date, byWeek: boolean): string[] {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const MAX = 400;

  // Start from the group-key of `start` so the first bucket aligns with
  // the user's range and not an arbitrary midnight earlier.
  const cursor = new Date(getGroupKey(start.toISOString(), byWeek));
  const endStamp = end.getTime();
  while (cursor.getTime() <= endStamp && out.length < MAX) {
    out.push(getGroupKey(cursor.toISOString(), byWeek));
    if (byWeek) {
      cursor.setDate(cursor.getDate() + 7);
    } else {
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return out;
}
