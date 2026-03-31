"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { SequenceAnalyticsTab } from "@/components/sequences/sequence-analytics-tab";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

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
  const [totalEnrollments, setTotalEnrollments] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);

  const loadStats = useCallback(async () => {
    if (!workspaceId) return;
    setStatsLoading(true);

    // Enrolled count
    const { count: enrolled } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId);

    // Get all enrollment IDs for this sequence
    const { data: enrollmentIds } = await supabase
      .from("sequence_enrollments")
      .select("id")
      .eq("sequence_id", sequenceId);

    const ids = (enrollmentIds || []).map((e) => e.id);

    // Emails sent
    let sent = 0;
    let uniqueOpens = 0;
    let replies = 0;
    let clicks = 0;

    if (ids.length > 0) {
      const { count: sentCount } = await supabase
        .from("email_queue")
        .select("id", { count: "exact", head: true })
        .in("enrollment_id", ids)
        .eq("status", "sent");
      sent = sentCount || 0;

      // Get tracking IDs for sent emails
      const { data: sentEmails } = await supabase
        .from("email_queue")
        .select("tracking_id")
        .in("enrollment_id", ids)
        .eq("status", "sent");

      const trackingIds = (sentEmails || []).map((e) => e.tracking_id).filter(Boolean);

      if (trackingIds.length > 0) {
        const { data: events } = await supabase
          .from("email_events")
          .select("event_type, tracking_id")
          .in("tracking_id", trackingIds);

        if (events) {
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {enrollments.map((e) => {
                  const badge =
                    ENROLLMENT_STATUS[e.status ?? "active"] || ENROLLMENT_STATUS.active;
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
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`text-2xl font-bold ${valueClass ?? "text-slate-900"}`}>{value}</div>
      <div className="text-sm text-slate-500 mt-1">{label}</div>
    </div>
  );
}
