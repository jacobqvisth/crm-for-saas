"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Calendar, Trash2, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import StopsReorderList, {
  type ReorderStop,
} from "@/components/routes/stops-reorder-list";
import MarkVisitedSheet, {
  type MarkVisitedSheetState,
} from "@/components/routes/mark-visited-sheet";
import RemoveStopModal, {
  type RemoveReason,
} from "@/components/routes/remove-stop-modal";
import AddStopSheet, {
  type AddStopSheetState,
} from "@/components/routes/add-stop-sheet";
import type {
  RouteMapStop,
  RouteMapOrigin,
} from "@/components/routes/route-map";
import { type VisitOutcome } from "@/lib/routes/visits-decision";

const RouteMap = dynamic(() => import("@/components/routes/route-map"), {
  ssr: false,
  loading: () => (
    <div className="aspect-square md:aspect-[16/9] w-full rounded-lg border border-slate-200 bg-slate-100 animate-pulse" />
  ),
});

type RouteDetail = {
  id: string;
  workspace_id: string;
  cluster_label: string;
  mode: "mixed" | "cold" | "lapsed";
  mode_fallback_reason: string | null;
  origin_address: string;
  origin_latitude: number;
  origin_longitude: number;
  scheduled_for: string | null;
  status: string;
  stop_count: number;
  total_drive_seconds: number;
  total_drive_meters: number;
  estimated_day_seconds: number;
  google_maps_deeplink: string;
  routes_api_response: unknown;
  assigned_to: string | null;
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
  visited_at: string | null;
  visit_outcome: VisitOutcome | null;
  visit_notes: string | null;
  follow_up_required: boolean | null;
  last_emailed_at: string | null;
  discovered_shops: { name: string | null; address: string | null } | null;
  companies: { name: string | null; address: string | null } | null;
};

type FieldVisitsSettings = {
  auto_followup_enabled: boolean;
  sequence_by_outcome: Partial<Record<VisitOutcome, string>>;
};

type Member = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_current_user: boolean;
};

const MAX_STOPS = 10;
const MIN_STOPS = 4;

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

function extractPolyline(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { routes?: { polyline?: { encodedPolyline?: string } }[] };
  return r.routes?.[0]?.polyline?.encodedPolyline ?? null;
}

function memberInitials(member: Member | null | undefined): string {
  if (!member) return "—";
  const name = member.full_name ?? member.email ?? "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduledFor, setScheduledFor] = useState("");
  const [saving, setSaving] = useState(false);
  const [fvSettings, setFvSettings] = useState<FieldVisitsSettings | null>(null);
  const [sheetState, setSheetState] = useState<MarkVisitedSheetState | null>(null);
  const [submittingVisit, setSubmittingVisit] = useState(false);

  const [removeState, setRemoveState] = useState<{ stopId: string; shopName: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState<AddStopSheetState | null>(null);
  const [addingStop, setAddingStop] = useState(false);

  const [members, setMembers] = useState<Member[]>([]);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ?? "";

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/field-visits");
        if (!res.ok) return;
        const data = (await res.json()) as FieldVisitsSettings;
        if (!cancelled) setFvSettings(data);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fetch("/api/settings/team")
      .then((r) => r.json())
      .then((data: { members?: Member[] }) => setMembers(data.members ?? []))
      .catch(() => {});
  }, []);

  const currentMember = useMemo(() => members.find((m) => m.is_current_user) ?? null, [members]);
  const isAdmin = currentMember?.role === "admin";
  const assignee = useMemo(
    () => (route?.assigned_to ? members.find((m) => m.user_id === route.assigned_to) ?? null : null),
    [route?.assigned_to, members],
  );

  async function patchSchedule(scheduled_for: string, force = false) {
    const res = await fetch(`/api/routes/${id}${force ? "?force=true" : ""}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_for, status: "scheduled" }),
    });
    if (res.status === 409 && !force) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string; detail?: string };
      const ok = window.confirm(
        `${body.detail ?? "That date is unavailable for the assignee."} Schedule anyway?`,
      );
      if (ok) return patchSchedule(scheduled_for, true);
      return;
    }
    if (!res.ok) {
      toast.error("Failed to schedule");
      return;
    }
    toast.success("Scheduled");
    fetchRoute();
  }

  async function handleSchedule() {
    if (!scheduledFor) {
      toast.error("Pick a date first");
      return;
    }
    await patchSchedule(scheduledFor);
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

  async function handleReassign(userId: string | null) {
    const res = await fetch(`/api/routes/${id}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      toast.error("Failed to reassign");
      return;
    }
    toast.success("Reassigned");
    fetchRoute();
  }

  async function handleReorder(orderedIds: string[], force = false): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/routes/${id}/reorder${force ? "?force=true" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stopIds: orderedIds }),
        },
      );

      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          estimated_day_seconds?: number;
        };
        const dayHM = body.estimated_day_seconds
          ? formatHM(body.estimated_day_seconds)
          : "8h+";
        const ok = window.confirm(
          `This route is now ${dayHM}, longer than the 7.5h day window. Save anyway?`,
        );
        if (ok) await handleReorder(orderedIds, true);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        toast.error(text || "Failed to save new order");
        return;
      }

      toast.success("Order saved");
      await fetchRoute();
    } finally {
      setSaving(false);
    }
  }

  async function submitRemove(reason: RemoveReason, notes: string | undefined) {
    if (!removeState) return;
    setRemoving(true);
    const wasAtCap = stops.length >= MAX_STOPS;
    try {
      const res = await fetch(`/api/routes/${id}/stops/${removeState.stopId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, notes: notes || undefined }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        toast.error(text || "Failed to remove stop");
        return;
      }
      toast.success(wasAtCap ? "Stop removed — pick a replacement" : "Stop removed");
      setRemoveState(null);
      await fetchRoute();
      if (wasAtCap) setAddSheetOpen({ open: true });
    } finally {
      setRemoving(false);
    }
  }

  async function submitAdd(
    payload: { discoveredShopId?: string; companyId?: string },
    force = false,
  ) {
    setAddingStop(true);
    try {
      const res = await fetch(`/api/routes/${id}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, force }),
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          estimated_day_seconds?: number;
        };
        if (body.error === "max_stops_reached") {
          toast.error(`Route already has ${MAX_STOPS} stops.`);
          return;
        }
        if (body.error === "exceeds_day_window") {
          const dayHM = body.estimated_day_seconds
            ? formatHM(body.estimated_day_seconds)
            : "8h+";
          const ok = window.confirm(
            `Adding this stop pushes the route to ${dayHM}, over the 7.5h day window. Add anyway?`,
          );
          if (ok) return submitAdd(payload, true);
          return;
        }
        toast.error(body.error ?? "Conflict");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        toast.error(text || "Failed to add stop");
        return;
      }
      toast.success("Stop added");
      setAddSheetOpen(null);
      await fetchRoute();
    } finally {
      setAddingStop(false);
    }
  }

  const reorderStops: ReorderStop[] = useMemo(
    () =>
      stops.map((s) => ({
        id: s.id,
        shop_name: s.shop_name,
        shop_address: s.shop_address,
        legDriveSeconds: s.leg_drive_seconds,
        isLapsed: s.company_id != null,
        visitedAt: s.visited_at,
        visitOutcome: s.visit_outcome,
        companyId: s.company_id,
        discoveredShopId: s.discovered_shop_id,
        lastEmailedAt: s.last_emailed_at,
      })),
    [stops],
  );

  const visitedCount = stops.filter((s) => s.visited_at).length;
  const followUpCount = stops.filter((s) => s.follow_up_required).length;
  const remainingCount = stops.length - visitedCount;

  const configuredOutcomes = useMemo(() => {
    const set = new Set<VisitOutcome>();
    if (fvSettings?.sequence_by_outcome) {
      for (const [k, v] of Object.entries(fvSettings.sequence_by_outcome)) {
        if (typeof v === "string" && v.length > 0) set.add(k as VisitOutcome);
      }
    }
    return set;
  }, [fvSettings]);

  const autoEnrollOutcomes: VisitOutcome[] = ["interested", "no_answer"];
  const missingSequenceOutcomes = autoEnrollOutcomes.filter((o) => !configuredOutcomes.has(o));

  function openSheet(stopId: string) {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) return;
    setSheetState({
      stopId,
      shopName: stop.shop_name,
      initialOutcome: stop.visit_outcome ?? undefined,
      initialNotes: stop.visit_notes ?? undefined,
    });
  }

  function openRemove(stopId: string) {
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) return;
    setRemoveState({ stopId, shopName: stop.shop_name });
  }

  async function handleSubmitVisit(input: {
    outcome: VisitOutcome;
    notes?: string;
    enrollOverride?: boolean;
  }) {
    if (!sheetState) return;
    setSubmittingVisit(true);
    try {
      const res = await fetch(`/api/routes/${id}/stops/${sheetState.stopId}/visit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        toast.error(text || "Failed to log visit");
        return;
      }
      const data = (await res.json()) as {
        enrollmentId?: string;
        enrollmentSkipReason?: string;
        promotedCompanyId?: string;
      };
      if (data.enrollmentId) toast.success("Visit logged · enrolled in follow-up");
      else if (data.enrollmentSkipReason === "no_contact")
        toast.success("Visit logged · no contact to enroll — add one first");
      else if (data.promotedCompanyId) toast.success("Visit logged · shop promoted to company");
      else toast.success("Visit logged");
      setSheetState(null);
      await fetchRoute();
    } finally {
      setSubmittingVisit(false);
    }
  }

  const mapStops: RouteMapStop[] = useMemo(
    () =>
      stops.map((s) => ({
        id: s.id,
        lat: s.latitude,
        lng: s.longitude,
        shop_name: s.shop_name,
        shop_address: s.shop_address,
        legDriveSeconds: s.leg_drive_seconds,
        isLapsed: s.company_id != null,
      })),
    [stops],
  );

  const mapOrigin: RouteMapOrigin | null = useMemo(() => {
    if (!route) return null;
    return {
      address: route.origin_address,
      lat: route.origin_latitude,
      lng: route.origin_longitude,
    };
  }, [route]);

  const encodedPolyline = useMemo(
    () => (route ? extractPolyline(route.routes_api_response) : null),
    [route],
  );

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
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
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-slate-500">Route not found.</p>
        <Link href="/routes" className="text-indigo-600 text-sm">← Back to routes</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Link
        href="/routes"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to routes
      </Link>

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

          <span
            className="inline-flex items-center gap-1.5 text-xs text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded"
            title={assignee ? assignee.full_name ?? assignee.email ?? "" : "Unassigned"}
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-[10px] font-semibold text-slate-700 border border-slate-200">
              {memberInitials(assignee)}
            </span>
            {assignee ? assignee.full_name ?? assignee.email : "Unassigned"}
          </span>

          {isAdmin && members.length > 1 && (
            <select
              value={route.assigned_to ?? ""}
              onChange={(e) => handleReassign(e.target.value || null)}
              className="text-xs border border-slate-200 rounded px-2 py-0.5 text-slate-700 bg-white"
              aria-label="Reassign route"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name ?? m.email ?? "?"}
                </option>
              ))}
            </select>
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

        {stops.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="font-semibold text-slate-900">{visitedCount}</span> of{" "}
              {stops.length} visited
            </span>
            <span>
              <span className="font-semibold text-slate-900">{remainingCount}</span> remaining
            </span>
            <span>
              <span className="font-semibold text-slate-900">{followUpCount}</span> follow-up
              {followUpCount === 1 ? "" : "s"} queued
            </span>
          </div>
        )}
      </div>

      {fvSettings && missingSequenceOutcomes.length > 0 && fvSettings.auto_followup_enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-900">
            <p className="font-medium">
              No auto-enroll sequence configured for:{" "}
              {missingSequenceOutcomes.map((o) => o.replace("_", " ")).join(", ")}.
            </p>
            <p className="mt-1">
              Visits with these outcomes will be logged but no follow-up email will fire.{" "}
              <Link href="/settings/field-visits" className="underline hover:text-amber-700">
                Configure
              </Link>
            </p>
          </div>
        </div>
      )}

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

      {stops.length > 0 && stops.length < MIN_STOPS && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4 text-xs text-amber-900">
          Only {stops.length} stops left — consider adding more or discarding the route.
        </div>
      )}

      <div className="mb-4">
        {apiKey && mapOrigin ? (
          <RouteMap
            apiKey={apiKey}
            origin={mapOrigin}
            stops={mapStops}
            encodedPolyline={encodedPolyline}
          />
        ) : (
          <div className="aspect-[16/9] w-full rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-sm text-slate-500 px-4 text-center">
            {apiKey
              ? "Loading map…"
              : "Map disabled — NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY not set in this environment."}
          </div>
        )}
      </div>

      <div className="mb-4">
        <StopsReorderList
          stops={reorderStops}
          saving={saving}
          onSave={(orderedIds) => handleReorder(orderedIds)}
          onMarkVisited={openSheet}
          onRemove={openRemove}
          onAddStop={() => setAddSheetOpen({ open: true })}
          maxStops={MAX_STOPS}
        />
      </div>

      <div className="flex items-center justify-end">
        <button
          onClick={handleDiscard}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
        >
          <Trash2 className="w-4 h-4" />
          Discard route
        </button>
      </div>

      <MarkVisitedSheet
        state={sheetState}
        configuredOutcomes={configuredOutcomes}
        workspaceAutoEnabled={fvSettings?.auto_followup_enabled !== false}
        submitting={submittingVisit}
        onClose={() => setSheetState(null)}
        onSubmit={handleSubmitVisit}
      />

      <RemoveStopModal
        state={removeState}
        submitting={removing}
        onClose={() => setRemoveState(null)}
        onSubmit={submitRemove}
      />

      <AddStopSheet
        state={addSheetOpen}
        routeId={id}
        submitting={addingStop}
        onClose={() => setAddSheetOpen(null)}
        onSubmit={(payload) => submitAdd(payload)}
      />
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
