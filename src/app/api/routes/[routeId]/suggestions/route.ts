import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { haversineKm } from "@/lib/routes/cluster";
import { DEFAULT_MIN_REVISIT_DAYS } from "@/lib/routes/generate";
import type { Json } from "@/lib/database.types";

type SuggestionRow = {
  kind: "discovered_shop" | "company";
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  mode: "cold" | "lapsed";
  distanceKm: number;
  lastVisitedAt?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "10")));

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select("id, workspace_id, origin_latitude, origin_longitude")
    .eq("id", routeId)
    .maybeSingle();
  if (routeErr) return NextResponse.json({ error: routeErr.message }, { status: 500 });
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", route.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Compute the centroid of the existing stops (or fall back to origin).
  const { data: stops } = await supabase
    .from("route_stops")
    .select("latitude, longitude, company_id, discovered_shop_id")
    .eq("route_id", routeId);

  const stopList = stops ?? [];
  const centroid = stopList.length > 0
    ? {
        lat: stopList.reduce((s, st) => s + st.latitude, 0) / stopList.length,
        lng: stopList.reduce((s, st) => s + st.longitude, 0) / stopList.length,
      }
    : { lat: route.origin_latitude, lng: route.origin_longitude };

  const existingCompanyIds = new Set(
    stopList.filter((s) => s.company_id).map((s) => s.company_id as string),
  );
  const existingDiscoveredIds = new Set(
    stopList.filter((s) => s.discovered_shop_id).map((s) => s.discovered_shop_id as string),
  );

  // Workspace-default min revisit interval.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", route.workspace_id)
    .maybeSingle();
  const workspaceMinRevisit = readWorkspaceMinRevisit(workspace?.settings ?? null);

  // Pull candidate companies in workspace, not flagged, with coords.
  // Then in-memory filter by ICP shop type lookup (companies don't store shop_type
  // directly — we approximate via discovered_shops shop_type when available, else accept all
  // non-flagged companies as cold/lapsed candidates).
  const PAGE = 1000;
  const candidateRows: {
    kind: "discovered_shop" | "company";
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    activatedAt: string | null;
    minRevisit: number | null;
  }[] = [];

  // Companies pool — same filters as generate.ts.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("companies")
      .select(
        "id, name, address, latitude, longitude, subscription_status, customer_status, activated_at, do_not_route, min_revisit_interval_days",
      )
      .eq("workspace_id", route.workspace_id)
      .eq("do_not_route", false)
      .or("subscription_status.is.null,subscription_status.not.in.(active,trialing,past_due)")
      .or("customer_status.is.null,customer_status.not.in.(active,trialing)")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (r.latitude == null || r.longitude == null || !r.address) continue;
      if (existingCompanyIds.has(r.id)) continue;
      candidateRows.push({
        kind: "company",
        id: r.id,
        name: r.name,
        address: r.address,
        lat: r.latitude,
        lng: r.longitude,
        activatedAt: r.activated_at,
        minRevisit: r.min_revisit_interval_days ?? null,
      });
    }
    if (data.length < PAGE) break;
  }

  // Filter recently-visited companies.
  const candidateCompanyIds = candidateRows.map((r) => r.id);
  const recentVisits = await fetchRecentVisits(supabase, route.workspace_id, candidateCompanyIds);
  const now = Date.now();
  const filtered: (SuggestionRow & { lastVisitedAt?: string })[] = [];
  for (const r of candidateRows) {
    const interval = r.minRevisit ?? workspaceMinRevisit ?? DEFAULT_MIN_REVISIT_DAYS;
    const lastVisited = recentVisits.get(r.id);
    if (lastVisited) {
      const ageDays = (now - new Date(lastVisited).getTime()) / 86_400_000;
      if (ageDays < interval) continue;
    }
    const distanceKm = haversineKm({ lat: r.lat, lng: r.lng }, centroid);
    filtered.push({
      kind: "company",
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      mode: r.activatedAt ? "lapsed" : "cold",
      distanceKm,
      lastVisitedAt: lastVisited,
    });
  }

  filtered.sort((a, b) => a.distanceKm - b.distanceKm);
  const top = filtered.slice(0, limit);

  void existingDiscoveredIds; // reserved for future discovered_shops suggestions
  return NextResponse.json({ suggestions: top });
}

function readWorkspaceMinRevisit(settings: unknown): number | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const fv = (settings as Record<string, Json>).field_visits;
  if (!fv || typeof fv !== "object" || Array.isArray(fv)) return null;
  const v = (fv as Record<string, Json>).min_revisit_interval_days;
  return typeof v === "number" && v > 0 ? v : null;
}

async function fetchRecentVisits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, string>> {
  const recent = new Map<string, string>();
  if (companyIds.length === 0) return recent;
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("route_stops")
      .select("company_id, visited_at")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice)
      .not("visited_at", "is", null)
      .order("visited_at", { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.company_id || !row.visited_at) continue;
      if (!recent.has(row.company_id)) recent.set(row.company_id, row.visited_at);
    }
  }
  return recent;
}
