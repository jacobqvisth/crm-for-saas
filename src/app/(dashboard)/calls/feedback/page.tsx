"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";

type FeedbackRow = {
  id: string;
  category: string;
  severity: string | null;
  title: string | null;
  body: string;
  status: string;
  created_at: string;
  contacts: { first_name: string | null; last_name: string | null; email: string } | null;
  companies: { name: string | null } | null;
};

const STATUSES = ["new", "triaged", "planned", "shipped", "wont_do"] as const;
const CATEGORY_TONE: Record<string, string> = {
  bug: "bg-rose-100 text-rose-700",
  feature_request: "bg-indigo-100 text-indigo-700",
  complaint: "bg-amber-100 text-amber-700",
  praise: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

export default function CallFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusFilter === "all" ? "" : `?status=${statusFilter}`;
      const res = await fetch(`/api/calls/feedback${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load feedback");
      setRows(json.feedback ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      const res = await fetch(`/api/calls/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
      load();
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <Link href="/calls" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Calls
      </Link>

      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold text-slate-900">Call feedback</h1>
      </div>
      <p className="mt-1 text-sm text-slate-500">Fixes, ideas and problems captured on calls with existing users.</p>

      <div className="mt-4 flex gap-1.5">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1.5 text-sm capitalize ${statusFilter === s ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              No feedback yet.
            </p>
          )}
          {rows.map((r) => {
            const who =
              [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim() ||
              r.contacts?.email ||
              "Unknown";
            return (
              <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${CATEGORY_TONE[r.category] ?? "bg-slate-100 text-slate-600"}`}>
                      {r.category.replace("_", " ")}
                    </span>
                    {r.severity && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-600">
                        {r.severity}
                      </span>
                    )}
                  </div>
                  <select
                    value={r.status}
                    onChange={(e) => updateStatus(r.id, e.target.value)}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs capitalize"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                {r.title && <div className="mt-2 text-sm font-medium text-slate-900">{r.title}</div>}
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.body}</p>
                <div className="mt-2 text-xs text-slate-400">
                  {who}
                  {r.companies?.name ? ` · ${r.companies.name}` : ""}
                  {" · "}
                  {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
