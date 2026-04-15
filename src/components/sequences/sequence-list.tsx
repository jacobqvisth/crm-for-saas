"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Play,
  Pause,
  Copy,
  Archive,
  MoreHorizontal,
  Zap,
  AlertTriangle,
  TrendingUp,
  X,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Tables, Json } from "@/lib/database.types";

type Sequence = Tables<"sequences">;

interface SequenceHealth {
  auth_issue: boolean;
  high_bounces: boolean;
  paused_count: number;
}

interface SequenceWithStats extends Sequence {
  steps_count: number;
  stats: {
    enrolled: number;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
  };
  health?: SequenceHealth;
}

const COUNTRIES = [
  { code: "EE", name: "Estonia", defaultLang: "et" },
  { code: "SE", name: "Sweden", defaultLang: "sv" },
  { code: "FI", name: "Finland", defaultLang: "fi" },
  { code: "LV", name: "Latvia", defaultLang: "lv" },
  { code: "LT", name: "Lithuania", defaultLang: "lt" },
  { code: "NO", name: "Norway", defaultLang: "no" },
  { code: "DK", name: "Denmark", defaultLang: "da" },
] as const;

const LANGUAGES = [
  { code: "et", label: "Estonian" },
  { code: "sv", label: "Swedish" },
  { code: "fi", label: "Finnish" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "en", label: "English" },
] as const;

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  active: { label: "Active", className: "bg-green-100 text-green-700" },
  paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700" },
  archived: { label: "Archived", className: "bg-red-100 text-red-600" },
};

type SortField = "reply_rate" | "bounce_rate";
type SortDir = "asc" | "desc";

export function SequenceList() {
  const { workspaceId } = useWorkspace();
  const supabase = createClient();
  const router = useRouter();

  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [healthData, setHealthData] = useState<Record<string, SequenceHealth>>({});
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [dupDialog, setDupDialog] = useState<{ seq: Sequence } | null>(null);
  const [dupCountry, setDupCountry] = useState("");
  const [dupLang, setDupLang] = useState("");
  const [dupLoading, setDupLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ seq: Sequence } | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadSequences = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);

    let query = supabase
      .from("sequences")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });

    if (search.trim()) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      toast.error("Failed to load sequences");
      setLoading(false);
      return;
    }

    // Load steps count and stats for each sequence
    const enriched: SequenceWithStats[] = await Promise.all(
      (data || []).map(async (seq) => {
        const { count: stepsCount } = await supabase
          .from("sequence_steps")
          .select("*", { count: "exact", head: true })
          .eq("sequence_id", seq.id);

        // Try to get stats from the DB function
        let stats = {
          enrolled: 0, sent: 0, opened: 0, clicked: 0,
          replied: 0, bounced: 0, unsubscribed: 0,
        };

        const { data: statsData } = await supabase.rpc("get_sequence_stats", {
          p_sequence_id: seq.id,
        });

        if (statsData) {
          const s = (typeof statsData === "string" ? JSON.parse(statsData) : statsData) as Record<string, number>;
          stats = {
            enrolled: s.enrolled || 0,
            sent: s.sent || 0,
            opened: s.opened || 0,
            clicked: s.clicked || 0,
            replied: s.replied || 0,
            bounced: s.bounced || 0,
            unsubscribed: s.unsubscribed || 0,
          };
        }

        return {
          ...seq,
          steps_count: stepsCount || 0,
          stats,
        };
      })
    );

    setSequences(enriched);
    setLoading(false);
  }, [workspaceId, supabase, search]);

  const loadHealth = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await fetch("/api/sequences/health");
      if (res.ok) {
        const data = await res.json();
        setHealthData(data as Record<string, SequenceHealth>);
      }
    } catch {
      // Non-fatal — health badges are supplemental
    }
  }, [workspaceId]);

  useEffect(() => {
    loadSequences();
  }, [loadSequences]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const updateStatus = async (id: string, status: Sequence["status"]) => {
    if (!workspaceId) return;
    const { error } = await supabase
      .from("sequences")
      .update({ status })
      .eq("id", id)
      .eq("workspace_id", workspaceId);

    if (error) {
      toast.error("Failed to update sequence");
    } else {
      toast.success(`Sequence ${status === "active" ? "activated" : status === "paused" ? "paused" : "archived"}`);
      loadSequences();
    }
    setMenuOpen(null);
  };

  const openDuplicateDialog = (seq: Sequence) => {
    setDupCountry("");
    setDupLang("");
    setDupDialog({ seq });
    setMenuOpen(null);
  };

  const handleCountryChange = (countryCode: string) => {
    setDupCountry(countryCode);
    const country = COUNTRIES.find((c) => c.code === countryCode);
    if (country) {
      setDupLang(country.defaultLang);
    } else {
      setDupLang("");
    }
  };

  const duplicateSequence = async () => {
    if (!workspaceId || !dupDialog) return;
    const { seq } = dupDialog;

    const countryObj = COUNTRIES.find((c) => c.code === dupCountry);
    const langObj = LANGUAGES.find((l) => l.code === dupLang);
    const suffix = countryObj && langObj
      ? `(${countryObj.name} — ${langObj.label})`
      : countryObj
        ? `(${countryObj.name})`
        : "(Copy)";
    const newName = `${seq.name} ${suffix}`;

    setDupLoading(true);
    try {
      const res = await fetch("/api/sequences/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceSequenceId: seq.id,
          workspaceId,
          targetCountry: dupCountry,
          targetCountryName: countryObj?.name ?? "",
          targetLanguage: dupLang,
          targetLanguageLabel: langObj?.label ?? dupLang,
          newName,
        }),
      });

      const data = await res.json() as { sequenceId?: string; warnings?: string[]; error?: string };

      if (!res.ok) {
        toast.error(data.error || "Failed to duplicate sequence");
        return;
      }

      toast.success(`Sequence duplicated and translated to ${langObj?.label ?? dupLang}`);

      if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach((w) => toast(w, { icon: "⚠️" }));
      }

      setDupDialog(null);
      loadSequences();
    } catch {
      toast.error("Failed to duplicate sequence");
    } finally {
      setDupLoading(false);
    }
  };

  const deleteSequence = async () => {
    if (!deleteDialog) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/sequences/${deleteDialog.seq.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to delete sequence");
      } else {
        toast.success("Sequence deleted");
        setDeleteDialog(null);
        setDeleteConfirmName("");
        loadSequences();
      }
    } catch {
      toast.error("Failed to delete sequence");
    } finally {
      setDeleteLoading(false);
    }
  };

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedSequences = sortField
    ? [...sequences].sort((a, b) => {
        const aVal =
          sortField === "reply_rate"
            ? pct(a.stats.replied, a.stats.sent)
            : pct(a.stats.bounced, a.stats.sent);
        const bVal =
          sortField === "reply_rate"
            ? pct(b.stats.replied, b.stats.sent)
            : pct(b.stats.bounced, b.stats.sent);
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
      })
    : sequences;

  if (!workspaceId) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sequences</h1>
          <p className="text-sm text-slate-500 mt-1">
            Automate multi-step email campaigns
          </p>
        </div>
        <button
          onClick={() => router.push("/sequences/new")}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Sequence
        </button>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sequences..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <Zap className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-slate-900">No sequences yet</h3>
          <p className="text-sm text-slate-500 mt-1">
            Create your first email sequence to start automating outreach.
          </p>
          <button
            onClick={() => router.push("/sequences/new")}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Sequence
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Steps</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Enrolled</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Sent</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Open %</th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  <button
                    onClick={() => handleSortClick("reply_rate")}
                    className="inline-flex items-center gap-1 hover:text-slate-700 transition-colors"
                  >
                    Reply %
                    <span className="text-slate-300">
                      {sortField === "reply_rate" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                    </span>
                  </button>
                </th>
                <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">
                  <button
                    onClick={() => handleSortClick("bounce_rate")}
                    className="inline-flex items-center gap-1 hover:text-slate-700 transition-colors"
                  >
                    Bounce %
                    <span className="text-slate-300">
                      {sortField === "bounce_rate" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                    </span>
                  </button>
                </th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sortedSequences.map((seq) => {
                const badge = STATUS_BADGES[seq.status] || STATUS_BADGES.draft;
                return (
                  <tr
                    key={seq.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/sequences/${seq.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-900">{seq.name}</span>
                        {healthData[seq.id]?.auth_issue && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            <AlertTriangle className="w-3 h-3" />
                            Auth issue
                          </span>
                        )}
                        {healthData[seq.id]?.high_bounces && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                            <TrendingUp className="w-3 h-3" />
                            High bounces
                          </span>
                        )}
                        {(healthData[seq.id]?.paused_count ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                            {healthData[seq.id].paused_count} paused
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{seq.steps_count}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{seq.stats.enrolled}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">{seq.stats.sent}</td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">
                      {pct(seq.stats.opened, seq.stats.sent)}%
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">
                      {pct(seq.stats.replied, seq.stats.sent)}%
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-slate-600">
                      {pct(seq.stats.bounced, seq.stats.sent)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuOpen(menuOpen === seq.id ? null : seq.id)}
                          className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {menuOpen === seq.id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10">
                            {seq.status !== "active" && seq.status !== "archived" && (
                              <button
                                onClick={() => updateStatus(seq.id, "active")}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <Play className="w-3.5 h-3.5" /> Activate
                              </button>
                            )}
                            {seq.status === "active" && (
                              <button
                                onClick={() => updateStatus(seq.id, "paused")}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <Pause className="w-3.5 h-3.5" /> Pause
                              </button>
                            )}
                            <button
                              onClick={() => openDuplicateDialog(seq)}
                              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Copy className="w-3.5 h-3.5" /> Duplicate
                            </button>
                            {seq.status !== "archived" && (
                              <button
                                onClick={() => updateStatus(seq.id, "archived")}
                                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <Archive className="w-3.5 h-3.5" /> Archive
                              </button>
                            )}
                            <div className="my-1 border-t border-slate-100" />
                            <button
                              onClick={() => {
                                setDeleteConfirmName("");
                                setDeleteDialog({ seq });
                                setMenuOpen(null);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Duplicate dialog */}
      {dupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !dupLoading && setDupDialog(null)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md mx-4 p-6">
            <button
              onClick={() => setDupDialog(null)}
              disabled={dupLoading}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-lg font-semibold text-slate-900 mb-1">Duplicate Sequence</h2>
            <p className="text-sm text-slate-500 mb-5">
              Choose a target country and language for the copy of <span className="font-medium text-slate-700">{dupDialog.seq.name}</span>.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Country</label>
                <select
                  value={dupCountry}
                  onChange={(e) => handleCountryChange(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">Select country...</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Language</label>
                <select
                  value={dupLang}
                  onChange={(e) => setDupLang(e.target.value)}
                  disabled={!dupCountry}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="">Select language...</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              {dupCountry && dupLang && (
                <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                  New name: <span className="font-medium text-slate-700">{dupDialog.seq.name} ({COUNTRIES.find((c) => c.code === dupCountry)?.name} — {LANGUAGES.find((l) => l.code === dupLang)?.label})</span>
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setDupDialog(null)}
                disabled={dupLoading}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={duplicateSequence}
                disabled={!dupCountry || !dupLang || dupLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {dupLoading ? "Translating…" : "Duplicate"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete confirmation dialog */}
      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !deleteLoading && setDeleteDialog(null)} />
          <div className="relative bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md mx-4 p-6">
            <button
              onClick={() => setDeleteDialog(null)}
              disabled={deleteLoading}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-lg font-semibold text-slate-900 mb-2">Delete sequence?</h2>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete{" "}
              <span className="font-semibold text-slate-900">&quot;{deleteDialog.seq.name}&quot;</span>{" "}
              along with all of its steps, enrollments, and queued/sent email history records tied to it.
              This cannot be undone.
            </p>

            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Type the sequence name to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={deleteDialog.seq.name}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteDialog(null);
                  setDeleteConfirmName("");
                }}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={deleteSequence}
                disabled={deleteConfirmName !== deleteDialog.seq.name || deleteLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteLoading ? "Deleting..." : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
