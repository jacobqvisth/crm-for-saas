"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { format, formatDistanceToNow } from "date-fns";
import { Pause, Play, Trash2, Send, Eye, MousePointer, Reply, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import type { Tables } from "@/lib/database.types";

type Step = Tables<"sequence_steps">;

interface Enrollment {
  id: string;
  contact_id: string;
  status: string | null;
  current_step: number | null;
  enrolled_at: string | null;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    company: { name: string } | null;
  } | null;
}

interface QueueRow {
  id: string;
  enrollment_id: string;
  contact_id: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  email_events: { event_type: string; created_at: string }[];
}

interface ActivityInfo {
  type: "sent" | "open" | "click" | "reply" | "bounce";
  timestamp: string;
}

const EVENT_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; color: string }
> = {
  sent:   { icon: Send,           label: "Sent",    color: "text-slate-400" },
  open:   { icon: Eye,            label: "Opened",  color: "text-blue-500" },
  click:  { icon: MousePointer,   label: "Clicked", color: "text-indigo-500" },
  reply:  { icon: Reply,          label: "Replied", color: "text-green-500" },
  bounce: { icon: AlertTriangle,  label: "Bounced", color: "text-red-500" },
};

const ENROLLMENT_STATUS: Record<string, { label: string; className: string }> = {
  active:       { label: "Active",       className: "bg-green-100 text-green-700" },
  completed:    { label: "Completed",    className: "bg-blue-100 text-blue-700" },
  replied:      { label: "Replied",      className: "bg-indigo-100 text-indigo-700" },
  unsubscribed: { label: "Unsubscribed", className: "bg-red-100 text-red-600" },
  bounced:      { label: "Bounced",      className: "bg-orange-100 text-orange-700" },
  paused:       { label: "Paused",       className: "bg-yellow-100 text-yellow-700" },
};

interface SequenceContactsTabProps {
  sequenceId: string;
  steps: Step[];
}

export function SequenceContactsTab({ sequenceId, steps }: SequenceContactsTabProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Maps keyed by enrollment_id
  const [nextSendByEnrollment, setNextSendByEnrollment] = useState<Map<string, string>>(new Map());
  const [sentCountByEnrollment, setSentCountByEnrollment] = useState<Map<string, number>>(new Map());
  const [lastActivityByContact, setLastActivityByContact] = useState<Map<string, ActivityInfo>>(new Map());

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    // 1. Load enrollments with contact + company
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select(
        "id, contact_id, status, current_step, enrolled_at, contacts(id, first_name, last_name, email, company:companies(name))"
      )
      .eq("sequence_id", sequenceId)
      .order("enrolled_at", { ascending: false });

    if (!error && data) {
      setEnrollments(
        data.map((d) => ({
          ...d,
          contact: d.contacts as unknown as Enrollment["contact"],
        }))
      );

      const enrollIds = data.map((d) => d.id);

      if (enrollIds.length > 0) {
        // 2. Load email_queue rows with nested email_events for all enrollments at once
        const { data: queueData } = await supabase
          .from("email_queue")
          .select("id, enrollment_id, contact_id, status, scheduled_for, sent_at, email_events(event_type, created_at)")
          .in("enrollment_id", enrollIds);

        const rows = (queueData || []) as QueueRow[];

        // Compute nextSend (earliest scheduled_for where status='scheduled') per enrollment
        const nextSendMap = new Map<string, string>();
        const sentCountMap = new Map<string, number>();
        // Collect all events (including "sent" from queue) per contact_id
        const activityByContact = new Map<string, ActivityInfo>();

        for (const row of rows) {
          // Next send
          if (row.status === "scheduled") {
            const current = nextSendMap.get(row.enrollment_id);
            if (!current || row.scheduled_for < current) {
              nextSendMap.set(row.enrollment_id, row.scheduled_for);
            }
          }

          // Sent count
          if (row.status === "sent") {
            sentCountMap.set(row.enrollment_id, (sentCountMap.get(row.enrollment_id) || 0) + 1);

            // Track "sent" as an activity
            if (row.sent_at) {
              const existing = activityByContact.get(row.contact_id);
              if (!existing || row.sent_at > existing.timestamp) {
                activityByContact.set(row.contact_id, { type: "sent", timestamp: row.sent_at });
              }
            }
          }

          // Track email_events (open/click/reply/bounce) per contact
          for (const ev of row.email_events || []) {
            const existing = activityByContact.get(row.contact_id);
            if (!existing || ev.created_at > existing.timestamp) {
              activityByContact.set(row.contact_id, {
                type: ev.event_type as ActivityInfo["type"],
                timestamp: ev.created_at,
              });
            }
          }
        }

        setNextSendByEnrollment(nextSendMap);
        setSentCountByEnrollment(sentCountMap);
        setLastActivityByContact(activityByContact);
      } else {
        setNextSendByEnrollment(new Map());
        setSentCountByEnrollment(new Map());
        setLastActivityByContact(new Map());
      }
    }

    setLoading(false);
  }, [workspaceId, sequenceId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === enrollments.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(enrollments.map((e) => e.id)));
    }
  };

  const bulkUpdateStatus = async (status: string) => {
    if (!workspaceId || selected.size === 0) return;

    const { error } = await supabase
      .from("sequence_enrollments")
      .update({ status })
      .in("id", Array.from(selected));

    if (error) {
      toast.error("Failed to update enrollments");
    } else {
      toast.success(`${selected.size} enrollment(s) updated`);
      setSelected(new Set());
      load();
    }
  };

  const bulkRemove = async () => {
    if (!workspaceId || selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} contact(s) from sequence?`)) return;

    // Cancel scheduled emails first
    for (const enrollmentId of selected) {
      await supabase
        .from("email_queue")
        .update({ status: "cancelled" as const })
        .eq("enrollment_id", enrollmentId)
        .eq("status", "scheduled");
    }

    const { error } = await supabase
      .from("sequence_enrollments")
      .delete()
      .in("id", Array.from(selected));

    if (error) {
      toast.error("Failed to remove enrollments");
    } else {
      toast.success(`${selected.size} contact(s) removed`);
      setSelected(new Set());
      load();
    }
  };

  // Format step column: "2 / 5 · Email"
  const formatStep = (currentStep: number | null, enrollmentStatus: string | null): string => {
    if (enrollmentStatus === "completed" || enrollmentStatus === "replied") return "Completed";
    const total = steps.length;
    if (total === 0) return "—";
    const stepIdx = currentStep ?? 0;
    const step = steps[stepIdx];
    if (!step) return "Completed";
    const typeName = step.type.charAt(0).toUpperCase() + step.type.slice(1);
    return `${stepIdx + 1} / ${total} · ${typeName}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-indigo-50 rounded-lg">
          <span className="text-sm font-medium text-indigo-700">{selected.size} selected</span>
          <button
            onClick={() => bulkUpdateStatus("paused")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white rounded-md border border-slate-300 hover:bg-slate-50"
          >
            <Pause className="w-3 h-3" /> Pause
          </button>
          <button
            onClick={() => bulkUpdateStatus("active")}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white rounded-md border border-slate-300 hover:bg-slate-50"
          >
            <Play className="w-3 h-3" /> Resume
          </button>
          <button
            onClick={bulkRemove}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-white rounded-md border border-red-200 hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        </div>
      )}

      {enrollments.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-500">
          No contacts enrolled yet. Click &quot;Add Contacts&quot; to get started.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === enrollments.length && enrollments.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Company</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Email</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Step</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Last activity</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Next send</th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase px-4 py-3">Sent</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Enrolled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {enrollments.map((e) => {
                const badge = ENROLLMENT_STATUS[e.status ?? "active"] || ENROLLMENT_STATUS.active;
                const contactId = e.contact?.id ?? e.contact_id;
                const activity = lastActivityByContact.get(contactId);
                const nextSend = nextSendByEnrollment.get(e.id);
                const sentCount = sentCountByEnrollment.get(e.id) ?? 0;
                const ActivityIcon = activity ? (EVENT_CONFIG[activity.type]?.icon ?? Send) : null;
                const activityColor = activity ? (EVENT_CONFIG[activity.type]?.color ?? "text-slate-400") : "";
                const activityLabel = activity ? (EVENT_CONFIG[activity.type]?.label ?? "") : "";

                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleSelect(e.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 max-w-[150px]">
                      <span
                        className="truncate block"
                        title={[e.contact?.first_name, e.contact?.last_name].filter(Boolean).join(" ") || "—"}
                      >
                        {[e.contact?.first_name, e.contact?.last_name].filter(Boolean).join(" ") || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 max-w-[150px]">
                      <span
                        className="truncate block"
                        title={e.contact?.company?.name ?? "—"}
                      >
                        {e.contact?.company?.name ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.contact?.email || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {formatStep(e.current_step, e.status)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {activity && ActivityIcon ? (
                        <span className="inline-flex items-center gap-1">
                          <ActivityIcon className={`w-3.5 h-3.5 shrink-0 ${activityColor}`} />
                          <span>{activityLabel}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500 text-xs">
                            {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {nextSend ? format(new Date(nextSend), "MMM d, HH:mm") : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 text-right">
                      {sentCount > 0 ? sentCount : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                      {e.enrolled_at ? format(new Date(e.enrolled_at), "MMM d, yyyy") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
