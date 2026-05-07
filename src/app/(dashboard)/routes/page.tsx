"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Map, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useWorkspace } from "@/lib/hooks/use-workspace";

type RouteRow = {
  id: string;
  generated_at: string;
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

const MODE_BADGE: Record<RouteRow["mode"], string> = {
  mixed: "bg-violet-100 text-violet-700 border-violet-200",
  cold: "bg-sky-100 text-sky-700 border-sky-200",
  lapsed: "bg-amber-100 text-amber-700 border-amber-200",
};

function formatHM(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function RoutesPage() {
  const { workspaceId } = useWorkspace();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchRoutes = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/routes?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { routes: RouteRow[] };
      setRoutes(data.routes);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load routes");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    fetchRoutes();
  }, [fetchRoutes, workspaceId]);

  async function handleGenerate() {
    if (!workspaceId) {
      toast.error("Workspace not loaded");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/routes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Generation failed");
        return;
      }
      toast.success(`Generated ${body.routesCreated} routes`);
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Field routes</h1>
        <button
          onClick={handleGenerate}
          disabled={generating || !workspaceId}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Map className="w-4 h-4" />}
          {generating ? "Generating…" : "Generate today's routes"}
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
          No routes yet. Click <span className="font-medium">Generate today&apos;s routes</span> to make some.
        </div>
      ) : (
        <>
          <Section
            title="Candidate routes"
            description="Newly generated. Pick one and assign it to a date."
            rows={candidates}
          />
          <Section
            title="Scheduled routes"
            description="Already assigned to a day."
            rows={scheduled}
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
}: {
  title: string;
  description: string;
  rows: RouteRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
      <p className="text-xs text-slate-500 mb-3">{description}</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/routes/${r.id}`}
            className="block bg-white border border-slate-200 rounded-lg px-4 py-3 hover:shadow-sm hover:border-indigo-200 transition-all"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium text-slate-800">{r.cluster_label}</span>
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
              <span className="text-xs text-slate-500">{r.stop_count} stops</span>
              <span className="text-xs text-slate-500">drive {formatHM(r.total_drive_seconds)}</span>
              <span className="text-xs text-slate-500">day ≈ {formatHM(r.estimated_day_seconds)}</span>
              {r.scheduled_for && (
                <span className="text-xs text-indigo-600">→ {r.scheduled_for}</span>
              )}
              <span className="ml-auto text-xs text-slate-400">View →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
