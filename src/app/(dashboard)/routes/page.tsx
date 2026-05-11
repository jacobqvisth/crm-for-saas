"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Map as MapIcon, Loader2, ChevronDown, Filter } from "lucide-react";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";

type RouteRow = {
  id: string;
  generated_at: string;
  generated_by: string | null;
  assigned_to: string | null;
  generation_batch_id: string;
  mode: "mixed" | "cold" | "lapsed";
  mode_fallback_reason: string | null;
  cluster_label: string;
  scheduled_for: string | null;
  status: "candidate" | "scheduled" | "in_progress" | "completed" | "discarded";
  stop_count: number;
  total_drive_seconds: number;
  total_drive_meters: number;
  estimated_day_seconds: number;
  google_maps_deeplink: string;
};

type Member = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_current_user: boolean;
};

type Scope = "mine" | "all";

type Region =
  | "auto"
  | "stockholm-north"
  | "stockholm-south"
  | "stockholm-east"
  | "stockholm-west"
  | "uppsala"
  | "sodertalje"
  | "malardalen-west"
  | "norrtalje-area";

const REGION_LABELS: Record<Region, string> = {
  auto: "Auto (smart pick)",
  "stockholm-north": "Stockholm North",
  "stockholm-south": "Stockholm South",
  "stockholm-east": "Stockholm East",
  "stockholm-west": "Stockholm West",
  uppsala: "Uppsala",
  sodertalje: "Södertälje",
  "malardalen-west": "Mälardalen West",
  "norrtalje-area": "Norrtälje area",
};

const MODE_BADGE: Record<RouteRow["mode"], string> = {
  mixed: "bg-violet-100 text-violet-700 border-violet-200",
  cold: "bg-sky-100 text-sky-700 border-sky-200",
  lapsed: "bg-amber-100 text-amber-700 border-amber-200",
};

type FilterKey =
  | "exclude_already_emailed"
  | "exclude_never_emailed"
  | "exclude_replied"
  | "exclude_has_account";

const FILTER_OPTIONS: { key: FilterKey; label: string; hint: string }[] = [
  {
    key: "exclude_already_emailed",
    label: "Already received an email",
    hint: "Skip shops we have already sent any email to.",
  },
  {
    key: "exclude_never_emailed",
    label: "Never been emailed",
    hint: "Only include shops we have already emailed.",
  },
  {
    key: "exclude_replied",
    label: "Has replied to an email",
    hint: "Skip shops where any contact has replied.",
  },
  {
    key: "exclude_has_account",
    label: "Has a Wrenchlane account",
    hint: "Skip shops that are already onboarded as app workshops.",
  },
];

function cleanLabel(label: string): string {
  // Legacy routes have " (cold)" / " (lapsed)" / " (mixed)" appended to
  // cluster_label — redundant with the mode pill. Strip at render time;
  // new routes are saved without the suffix.
  return label.replace(/\s*\((cold|lapsed|mixed)\)\s*$/, "");
}

function formatHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function initials(member: Member | undefined): string {
  if (!member) return "—";
  const name = member.full_name ?? member.email ?? "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function RoutesPage() {
  const { workspaceId } = useWorkspace();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scope, setScope] = useState<Scope>("mine");
  const [generateFor, setGenerateFor] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>("auto");
  const [forDate, setForDate] = useState<string>("");
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterOpen) return;
    function onDocClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [filterOpen]);

  function toggleFilter(key: FilterKey) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const currentUser = useMemo(() => members.find((m) => m.is_current_user) ?? null, [members]);
  const isAdmin = currentUser?.role === "admin";
  const memberById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const fetchRoutes = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/routes?workspaceId=${workspaceId}&scope=${scope}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { routes: RouteRow[] };
      setRoutes(data.routes);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load routes");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, scope]);

  useEffect(() => {
    if (!workspaceId) return;
    fetchRoutes();
  }, [fetchRoutes, workspaceId]);

  useEffect(() => {
    fetch("/api/settings/team")
      .then((r) => r.json())
      .then((data: { members?: Member[] }) => setMembers(data.members ?? []))
      .catch(() => {
        // non-fatal
      });
  }, []);

  async function handleGenerate() {
    if (!workspaceId) {
      toast.error("Workspace not loaded");
      return;
    }
    setGenerating(true);
    try {
      const body: Record<string, unknown> = { workspaceId, region };
      if (generateFor && generateFor !== currentUser?.user_id) {
        body.forUserId = generateFor;
      }
      if (forDate) body.forDate = forDate;
      if (filters.size > 0) body.filters = Array.from(filters);
      const res = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.reason ?? result.error ?? "Generation failed");
        return;
      }
      toast.success(`Generated route: ${result.route.clusterLabel}`);
      fetchRoutes();
    } catch (err) {
      console.error(err);
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const candidates = routes.filter((r) => r.status === "candidate");
  const scheduled = routes
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold text-slate-900">Field routes</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && members.length > 1 && (
            <select
              value={generateFor ?? currentUser?.user_id ?? ""}
              onChange={(e) => setGenerateFor(e.target.value || null)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white"
              aria-label="Generate for"
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  Generate for: {m.full_name ?? m.email ?? "?"}
                </option>
              ))}
            </select>
          )}
          <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
            Where?
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white"
              aria-label="Region"
            >
              {(Object.keys(REGION_LABELS) as Region[]).map((key) => (
                <option key={key} value={key}>
                  {REGION_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
            For when?
            <input
              type="date"
              value={forDate}
              onChange={(e) => setForDate(e.target.value)}
              className="text-xs border border-slate-200 rounded px-2 py-1.5 text-slate-700 bg-white"
              aria-label="Schedule for date"
            />
          </label>
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 text-xs border rounded px-2 py-1.5 ${
                filters.size > 0
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              aria-haspopup="true"
              aria-expanded={filterOpen}
            >
              <Filter className="w-3.5 h-3.5" />
              Filter out
              {filters.size > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold">
                  {filters.size}
                </span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-1 w-72 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-left">
                <p className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
                  Exclude shops that…
                </p>
                <ul className="space-y-0.5">
                  {FILTER_OPTIONS.map((opt) => {
                    const checked = filters.has(opt.key);
                    return (
                      <li key={opt.key}>
                        <label
                          className={`flex items-start gap-2 px-2 py-2 rounded cursor-pointer ${
                            checked ? "bg-indigo-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFilter(opt.key)}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-medium text-slate-800">
                              {opt.label}
                            </span>
                            <span className="block text-[11px] text-slate-500">{opt.hint}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {filters.size > 0 && (
                  <div className="flex justify-end px-1 pt-2 pb-1 border-t border-slate-100 mt-1">
                    <button
                      type="button"
                      onClick={() => setFilters(new Set())}
                      className="text-[11px] text-slate-500 hover:text-slate-700"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating || !workspaceId}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapIcon className="w-4 h-4" />}
            {generating ? "Generating…" : "Generate route"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 text-xs">
        <button
          onClick={() => setScope("mine")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            scope === "mine"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          Mine
        </button>
        <button
          onClick={() => setScope("all")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            scope === "all"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All workspace routes
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : routes.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          No routes here. Click <span className="font-medium">Generate route</span> to make one.
        </div>
      ) : (
        <>
          <Section
            title="Candidate routes"
            description="Newly generated. Pick one and assign it to a date."
            rows={candidates}
            memberById={memberById}
          />
          <Section
            title="Scheduled routes"
            description="Already assigned to a day."
            rows={scheduled}
            memberById={memberById}
          />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  rows,
  memberById,
}: {
  title: string;
  description: string;
  rows: RouteRow[];
  memberById: Map<string, Member>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
      <p className="text-xs text-slate-500 mb-3">{description}</p>
      <div className="space-y-2">
        {rows.map((r) => {
          const assignee = r.assigned_to ? memberById.get(r.assigned_to) : undefined;
          return (
            <Link
              key={r.id}
              href={`/routes/${r.id}`}
              className="block bg-white border border-slate-200 rounded-lg px-4 py-3 hover:shadow-sm hover:border-indigo-200 transition-all"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-slate-800">{cleanLabel(r.cluster_label)}</span>
                <span
                  className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${MODE_BADGE[r.mode]}`}
                >
                  {r.mode}
                </span>
                {r.mode_fallback_reason && (
                  <span className="text-[10px] text-amber-600" title={r.mode_fallback_reason}>
                    fallback
                  </span>
                )}
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-700 border border-slate-200"
                  title={assignee ? assignee.full_name ?? assignee.email ?? "" : "Unassigned"}
                >
                  {initials(assignee)}
                </span>
                <span className="text-xs text-slate-500">{r.stop_count} stops</span>
                <span className="text-xs text-slate-500">drive {formatHM(r.total_drive_seconds)}</span>
                <span className="text-xs text-slate-500">day ≈ {formatHM(r.estimated_day_seconds)}</span>
                {r.scheduled_for && (
                  <span className="text-xs text-indigo-600">→ {r.scheduled_for}</span>
                )}
                <span className="ml-auto text-xs text-slate-400 inline-flex items-center gap-0.5">
                  View <ChevronDown className="w-3 h-3 -rotate-90" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
