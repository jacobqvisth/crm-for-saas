"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { format } from "date-fns";
import { Pause, Play, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

interface Enrollment {
  id: string;
  contact_id: string;
  status: string;
  current_step: number;
  enrolled_at: string;
  contact: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
  } | null;
}

const ENROLLMENT_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-700" },
  completed: { label: "Completed", className: "bg-blue-100 text-blue-700" },
  replied: { label: "Replied", className: "bg-indigo-100 text-indigo-700" },
  unsubscribed: { label: "Unsubscribed", className: "bg-red-100 text-red-600" },
  bounced: { label: "Bounced", className: "bg-orange-100 text-orange-700" },
  paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700" },
};

interface SequenceContactsTabProps {
  sequenceId: string;
}

export function SequenceContactsTab({ sequenceId }: SequenceContactsTabProps) {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id, contact_id, status, current_step, enrolled_at, contacts(id, first_name, last_name, email)")
      .eq("sequence_id", sequenceId)
      .eq("workspace_id", workspaceId)
      .order("enrolled_at", { ascending: false });

    if (!error && data) {
      setEnrollments(
        data.map((d) => ({
          ...d,
          contact: d.contacts as unknown as Enrollment["contact"],
        }))
      );
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
      .in("id", Array.from(selected))
      .eq("workspace_id", workspaceId);

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
      .in("id", Array.from(selected))
      .eq("workspace_id", workspaceId);

    if (error) {
      toast.error("Failed to remove enrollments");
    } else {
      toast.success(`${selected.size} contact(s) removed`);
      setSelected(new Set());
      load();
    }
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
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
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
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Email</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Status</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase px-4 py-3">Step</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase px-4 py-3">Enrolled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {enrollments.map((e) => {
                const badge = ENROLLMENT_STATUS[e.status] || ENROLLMENT_STATUS.active;
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
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {[e.contact?.first_name, e.contact?.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{e.contact?.email || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{e.current_step}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {format(new Date(e.enrolled_at), "MMM d, yyyy")}
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
