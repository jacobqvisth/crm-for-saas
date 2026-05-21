"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notNull } from "@/lib/types/guards";
import { pageAll, chunkedIn } from "@/lib/supabase-paging";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SequenceAnalyticsTab } from "@/components/sequences/sequence-analytics-tab";
import { InfoTooltip } from "@/components/info-tooltip";
import { ArrowLeft, Pause, Play, Mail } from "lucide-react";

const STAT_HELP: Record<string, string> = {
  Enrolled:
    "Total contacts ever enrolled in this sequence, regardless of current status.",
  "Emails Sent":
    "Sequence emails successfully handed off to Gmail. Excludes scheduled, paused, cancelled, or failed sends.",
  "Open Rate":
    "Unique emails opened ÷ emails sent. Known bots and scanners (Google Image Proxy, etc.) are filtered out. Repeat opens of the same email count once per hour.",
  "Reply Rate":
    "Real replies ÷ emails sent. Out-of-office and other auto-replies are detected via headers and subject patterns and excluded from this rate — they still appear in Inbox flagged as 'Out of office'.",
  "Click Rate":
    "Unique emails with a tracked link click ÷ emails sent.",
  "Bounce Rate":
    "Enrollments marked bounced ÷ total enrolled. Triggered by permanent (5xx) NDRs; soft (4xx) bounces are retried.",
  "Unsubscribe Rate":
    "Enrollments unsubscribed ÷ total enrolled.",
  Completed:
    "Enrollments that finished all sequence steps without being stopped by a reply, bounce, or unsubscribe.",
};
import { format } from "date-fns";
import Link from "next/link";
import toast from "react-hot-toast";

interface AnalyticsStats {
  enrolled: number;
  sent: number;
  openRate: number;
  replyRate: number;
  clickRate: number;
  bounceRate: number;
  unsubscribeRate: number;
  completed: number;
}

interface SenderBreakdown {
  sender_account_id: string;
  email_address: string;
  emails_sent: number;
  opens: number;
  replies: number;
}

interface Enrollment {
  id: string;
  contact_id: string;
  status: string | null;
  current_step: number | null;
  enrolled_at: string | null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    email: string;
  } | null;
}

const STATUS_FILTER_OPTIONS = ["all", "active", "completed", "bounced", "unsubscribed"] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

const ENROLLMENT_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", className: "bg-green-100 text-green-700" },
  bounced: { label: "Bounced", className: "bg-red-100 text-red-600" },
  unsubscribed: { label: "Unsubscribed", className: "bg-slate-100 text-slate-600" },
  paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700" },
  company_paused: { label: "Company Paused", className: "bg-orange-100 text-orange-700" },
  replied: { label: "Replied", className: "bg-indigo-100 text-indigo-700" },
};

const PAGE_SIZE = 50;

export default function SequenceAnalyticsPage() {
  const params = useParams();
  const sequenceId = params.id as string;
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [senderBreakdown, setSenderBreakdown] = useState<SenderBreakdown[]>([]);
  const [totalEnrollments, setTotalEnrollments] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!workspaceId) return;
    setStatsLoading(true);

    // Enrolled count
    const { count: enrolled } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId);

    // Get all enrollment IDs for this sequence — paginated. Sequences with
    // >1000 enrollments silently truncated to the first 1000, which then
    // capped every downstream stat (Sent, Open %, Reply %, etc.).
    const { data: enrollmentIds } = await pageAll<{ id: string }>(
      ({ from, to }) =>
        supabase
          .from("sequence_enrollments")
          .select("id")
          .eq("sequence_id", sequenceId)
          .order("id", { ascending: true })
          .range(from, to),
    );

    const ids = enrollmentIds.map((e) => e.id);

    // Emails sent
    let sent = 0;
    let uniqueOpens = 0;
    let replies = 0;
    let clicks = 0;

    if (ids.length > 0) {
      // `.in()` with >~500 UUIDs blows past PostgREST's URL length limit and
      // silently returns Bad Request — chunk it. Each chunk's count is
      // server-side, so summing chunks gives the true total.
      let sentCountSum = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { count: chunkCount } = await supabase
          .from("email_queue")
          .select("id", { count: "exact", head: true })
          .in("enrollment_id", chunk)
          .eq("status", "sent");
        sentCountSum += chunkCount || 0;
      }
      sent = sentCountSum;

      // Get tracking IDs for sent emails — chunked + paginated.
      const { data: sentEmails } = await chunkedIn<{ tracking_id: string | null }, string>(
        (chunk, { from, to }) =>
          supabase
            .from("email_queue")
            .select("tracking_id")
            .in("enrollment_id", chunk)
            .eq("status", "sent")
            .order("tracking_id", { ascending: true })
            .range(from, to),
        ids,
      );

      const trackingIds = sentEmails.map((e) => e.tracking_id).filter(notNull);

      if (trackingIds.length > 0) {
        const { data: events } = await chunkedIn<{ event_type: string; tracking_id: string }, string>(
          (chunk, { from, to }) =>
            supabase
              .from("email_events")
              .select("event_type, tracking_id")
              .in("tracking_id", chunk)
              .order("created_at", { ascending: true })
              .range(from, to),
          trackingIds,
        );

        const openSet = new Set<string>();
        const replySet = new Set<string>();
        const clickSet = new Set<string>();

        for (const ev of events) {
          if (ev.event_type === "open") openSet.add(ev.tracking_id);
          if (ev.event_type === "reply") replySet.add(ev.tracking_id);
          if (ev.event_type === "click") clickSet.add(ev.tracking_id);
        }

        uniqueOpens = openSet.size;
        replies = replySet.size;
        clicks = clickSet.size;
      }
    }

    // Bounced enrollments
    const { count: bouncedCount } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "bounced");

    // Unsubscribed enrollments
    const { count: unsubCount } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "unsubscribed");

    // Completed enrollments
    const { count: completedCount } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "completed");

    const enrolledTotal = enrolled || 0;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

    setStats({
      enrolled: enrolledTotal,
      sent,
      openRate: pct(uniqueOpens, sent),
      replyRate: pct(replies, sent),
      clickRate: pct(clicks, sent),
      bounceRate: pct(bouncedCount || 0, enrolledTotal),
      unsubscribeRate: pct(unsubCount || 0, enrolledTotal),
      completed: completedCount || 0,
    });

    // Sender breakdown — group sent emails by sender, join gmail_accounts for email address.
    // Paginated + chunked for the same reason as the headline stats above.
    if (ids.length > 0) {
      type SentByAccountRow = {
        sender_account_id: string | null;
        tracking_id: string | null;
        gmail_accounts: { email_address: string } | null;
      };
      const { data: sentByAccount } = await chunkedIn<SentByAccountRow, string>(
        (chunk, { from, to }) =>
          supabase
            .from("email_queue")
            .select("sender_account_id, tracking_id, gmail_accounts(email_address)")
            .in("enrollment_id", chunk)
            .eq("status", "sent")
            .order("tracking_id", { ascending: true })
            .range(from, to) as unknown as Promise<{
              data: SentByAccountRow[] | null;
              error: { message: string } | null;
            }>,
        ids,
      );

      if (sentByAccount.length > 0) {
        const allTrackingIds = sentByAccount.map((r) => r.tracking_id).filter(notNull);

        const { data: breakdownEvents } = allTrackingIds.length > 0
          ? await chunkedIn<{ event_type: string; tracking_id: string }, string>(
              (chunk, { from, to }) =>
                supabase
                  .from("email_events")
                  .select("event_type, tracking_id")
                  .in("tracking_id", chunk)
                  .order("created_at", { ascending: true })
                  .range(from, to),
              allTrackingIds,
            )
          : { data: [] as { event_type: string; tracking_id: string }[] };

        // Map tracking_id → events
        const opensByTracking = new Set(
          breakdownEvents.filter((e) => e.event_type === "open").map((e) => e.tracking_id)
        );
        const repliesByTracking = new Set(
          breakdownEvents.filter((e) => e.event_type === "reply").map((e) => e.tracking_id)
        );

        // Group by sender
        const bySender = new Map<string, { email_address: string; sent: number; opens: number; replies: number }>();
        for (const row of sentByAccount) {
          const accountId = row.sender_account_id;
          if (!accountId) continue;
          const emailAddress = row.gmail_accounts?.email_address ?? accountId;
          if (!bySender.has(accountId)) {
            bySender.set(accountId, { email_address: emailAddress, sent: 0, opens: 0, replies: 0 });
          }
          const entry = bySender.get(accountId)!;
          entry.sent++;
          if (row.tracking_id && opensByTracking.has(row.tracking_id)) entry.opens++;
          if (row.tracking_id && repliesByTracking.has(row.tracking_id)) entry.replies++;
        }

        setSenderBreakdown(
          Array.from(bySender.entries()).map(([id, data]) => ({
            sender_account_id: id,
            email_address: data.email_address,
            emails_sent: data.sent,
            opens: data.opens,
            replies: data.replies,
          })).sort((a, b) => b.emails_sent - a.emails_sent)
        );
      } else {
        setSenderBreakdown([]);
      }
    }

    setStatsLoading(false);
  }, [workspaceId, sequenceId, supabase]);

  const loadEnrollments = useCallback(async () => {
    if (!workspaceId) return;
    setTableLoading(true);

    let query = supabase
      .from("sequence_enrollments")
      .select(
        "id, contact_id, status, current_step, enrolled_at, contacts(first_name, last_name, email)",
        { count: "exact" }
      )
      .eq("sequence_id", sequenceId)
      .order("enrolled_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, count } = await query;

    if (data) {
      setEnrollments(
        data.map((d) => ({
          ...d,
          contact: d.contacts as unknown as Enrollment["contact"],
        }))
      );
    }
    setTotalEnrollments(count || 0);
    setTableLoading(false);
  }, [workspaceId, sequenceId, supabase, statusFilter, page]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  useEffect(() => {
    loadEnrollments();
  }, [loadEnrollments]);

  const handleEnrollmentAction = async (enrollmentId: string, action: "pause" | "resume") => {
    if (!workspaceId) return;
    setActionLoading(enrollmentId);
    try {
      const res = await fetch(`/api/sequences/enrollments/${enrollmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || `Failed to ${action} enrollment`);
      } else {
        toast.success(action === "pause" ? "Enrollment paused" : "Enrollment resumed");
        loadEnrollments();
        loadStats();
      }
    } catch {
      toast.error(`Failed to ${action} enrollment`);
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(totalEnrollments / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/sequences/${sequenceId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sequence
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">Sequence Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Delivery metrics and enrollment overview</p>
      </div>

      {/* Stat cards — row 1 */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-7 bg-slate-200 rounded w-16 mb-2" />
              <div className="h-4 bg-slate-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Enrolled" value={stats.enrolled.toLocaleString()} />
            <StatCard label="Emails Sent" value={stats.sent.toLocaleString()} />
            <StatCard label="Open Rate" value={`${stats.openRate}%`} />
            <StatCard label="Reply Rate" value={`${stats.replyRate}%`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Click Rate" value={`${stats.clickRate}%`} />
            <StatCard
              label="Bounce Rate"
              value={`${stats.bounceRate}%`}
              valueClass={stats.bounceRate > 5 ? "text-red-600" : undefined}
            />
            <StatCard
              label="Unsubscribe Rate"
              value={`${stats.unsubscribeRate}%`}
              valueClass={stats.unsubscribeRate > 2 ? "text-amber-600" : undefined}
            />
            <StatCard label="Completed" value={stats.completed.toLocaleString()} />
          </div>
        </>
      ) : null}

      {/* Per-step chart */}
      <SequenceAnalyticsTab sequenceId={sequenceId} />

      {/* Sender breakdown */}
      {!statsLoading && senderBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
            <Mail className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-medium text-slate-900">Sender Breakdown</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Sender
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Emails Sent
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Open Rate
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                  Reply Rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {senderBreakdown.map((row) => {
                const openRate = row.emails_sent > 0 ? Math.round((row.opens / row.emails_sent) * 100) : 0;
                const replyRate = row.emails_sent > 0 ? Math.round((row.replies / row.emails_sent) * 100) : 0;
                return (
                  <tr key={row.sender_account_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-900">{row.email_address}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{row.emails_sent.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{openRate}%</td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">{replyRate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Enrollment table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-medium text-slate-900">
            Enrolled Contacts{totalEnrollments > 0 ? ` (${totalEnrollments})` : ""}
          </h3>
          <div className="flex gap-1">
            {STATUS_FILTER_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-indigo-100 text-indigo-700"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {tableLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
          </div>
        ) : enrollments.length === 0 ? (
          <div className="text-center py-8 text-sm text-slate-500">No contacts found.</div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Email
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Status
                  </th>
                  <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Current Step
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Enrolled Date
                  </th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {enrollments.map((e) => {
                  const badge =
                    ENROLLMENT_STATUS[e.status ?? "active"] || ENROLLMENT_STATUS.active;
                  const isActive = e.status === "active";
                  const isPaused = e.status === "paused" || e.status === "company_paused";
                  const isLoading = actionLoading === e.id;
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {[e.contact?.first_name, e.contact?.last_name]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {e.contact?.email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-slate-600">
                        {e.current_step ?? 0}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {e.enrolled_at
                          ? format(new Date(e.enrolled_at), "MMM d, yyyy")
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isActive && (
                          <button
                            onClick={() => handleEnrollmentAction(e.id, "pause")}
                            disabled={isLoading}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
                          >
                            <Pause className="w-3 h-3" />
                            Pause
                          </button>
                        )}
                        {isPaused && (
                          <button
                            onClick={() => handleEnrollmentAction(e.id, "resume")}
                            disabled={isLoading}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-40"
                          >
                            <Play className="w-3 h-3" />
                            Resume
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  Showing {page * PAGE_SIZE + 1}–
                  {Math.min((page + 1) * PAGE_SIZE, totalEnrollments)} of {totalEnrollments}
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  const help = STAT_HELP[label];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`text-2xl font-bold ${valueClass ?? "text-slate-900"}`}>{value}</div>
      <div className="text-sm text-slate-500 mt-1 flex items-center gap-1">
        <span>{label}</span>
        {help && <InfoTooltip label={help} />}
      </div>
    </div>
  );
}
