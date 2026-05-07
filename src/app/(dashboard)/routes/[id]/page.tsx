"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Calendar, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

type RouteDetail = {
  id: string;
  workspace_id: string;
  cluster_label: string;
  mode: "mixed" | "cold" | "lapsed";
  mode_fallback_reason: string | null;
  origin_address: string;
  scheduled_for: string | null;
  status: string;
  stop_count: number;
  total_drive_seconds: number;
  total_drive_meters: number;
  estimated_day_seconds: number;
  google_maps_deeplink: string;
};

type Stop = {
  id: string;
  stop_order: number;
  discovered_shop_id: string | null;
  company_id: string | null;
  shop_name: string;
  shop_address: string;
  latitude: number;
  longitude: number;
  leg_drive_seconds: number | null;
  leg_drive_meters: number | null;
  discovered_shops: { name: string | null; address: string | null } | null;
  companies: { name: string | null; address: string | null } | null;
};

const MODE_BADGE: Record<RouteDetail["mode"], string> = {
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

function formatKm(meters: number | null): string | null {
  if (meters == null) return null;
  return `${(meters / 1000).toFixed(1)} km`;
}

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduledFor, setScheduledFor] = useState("");

  const fetchRoute = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/routes/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { route: RouteDetail; stops: Stop[] };
      setRoute(data.route);
      setStops(data.stops);
      setScheduledFor(data.route.scheduled_for ?? "");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load route");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRoute();
  }, [fetchRoute]);

  async function handleSchedule() {
    if (!scheduledFor) {
      toast.error("Pick a date first");
      return;
    }
    const res = await fetch(`/api/routes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_for: scheduledFor, status: "scheduled" }),
    });
    if (!res.ok) {
      toast.error("Failed to schedule");
      return;
    }
    toast.success("Scheduled");
    fetchRoute();
  }

  async function handleDiscard() {
    const res = await fetch(`/api/routes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "discarded" }),
    });
    if (!res.ok) {
      toast.error("Failed to discard");
      return;
    }
    toast.success("Discarded");
    router.push("/routes");
  }

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="space-y-2">
          <div className="h-8 bg-slate-100 animate-pulse rounded w-1/3" />
          <div className="h-32 bg-slate-100 animate-pulse rounded" />
          <div className="h-64 bg-slate-100 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-slate-500">Route not found.</p>
        <Link href="/routes" className="text-indigo-600 text-sm">← Back to routes</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link
        href="/routes"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to routes
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h1 className="text-xl font-semibold text-slate-900">{route.cluster_label}</h1>
          <span
            className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${MODE_BADGE[route.mode]}`}
          >
            {route.mode}
          </span>
          {route.mode_fallback_reason && (
            <span
              className="text-[10px] text-amber-600 border border-amber-200 bg-amber-50 px-2 py-0.5 rounded"
              title={route.mode_fallback_reason}
            >
              fallback: {route.mode_fallback_reason}
            </span>
          )}
          <span className="text-xs text-slate-500 ml-auto">Status: {route.status}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <Stat label="Stops" value={String(route.stop_count)} />
          <Stat label="Drive time" value={formatHM(route.total_drive_seconds)} />
          <Stat label="Drive distance" value={`${(route.total_drive_meters / 1000).toFixed(1)} km`} />
          <Stat label="Day length" value={formatHM(route.estimated_day_seconds)} />
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Origin: <span className="text-slate-700">{route.origin_address}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={route.google_maps_deeplink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Open in Google Maps
          </a>

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              className="border border-slate-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
            <button
              onClick={handleSchedule}
              className="px-3 py-1.5 bg-slate-100 text-slate-700 text-sm rounded hover:bg-slate-200"
            >
              {route.status === "scheduled" ? "Update date" : "Schedule"}
            </button>
          </div>
        </div>
      </div>

      {/* Stops */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left w-10">#</th>
              <th className="px-4 py-2 text-left">Shop</th>
              <th className="px-4 py-2 text-left">Address</th>
              <th className="px-4 py-2 text-right">Leg drive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stops.map((s) => {
              const linkedHref = s.company_id
                ? `/companies/${s.company_id}`
                : s.discovered_shop_id
                ? `/discovery?focus=${s.discovered_shop_id}`
                : null;
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-slate-500">{s.stop_order + 1}</td>
                  <td className="px-4 py-2 text-slate-800">
                    {linkedHref ? (
                      <Link href={linkedHref} className="text-indigo-600 hover:underline">
                        {s.shop_name}
                      </Link>
                    ) : (
                      s.shop_name
                    )}
                    {s.company_id && (
                      <span className="ml-2 text-[10px] uppercase text-amber-600">lapsed</span>
                    )}
                    {s.discovered_shop_id && (
                      <span className="ml-2 text-[10px] uppercase text-sky-600">cold</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">{s.shop_address}</td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {s.leg_drive_seconds != null ? (
                      <>
                        {formatHM(s.leg_drive_seconds)}
                        <span className="ml-1 text-slate-400">({formatKm(s.leg_drive_meters)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleDiscard}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
        >
          <Trash2 className="w-4 h-4" />
          Discard route
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-slate-400 tracking-wide">{label}</div>
      <div className="text-base text-slate-800 font-medium">{value}</div>
    </div>
  );
}
