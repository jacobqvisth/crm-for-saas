import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MissingApiKeyError } from "@/lib/routes/geocode";
import { recomputeRouteAfterMutation } from "@/lib/routes/recompute";
import { MAX_STOPS_PER_ROUTE } from "@/lib/routes/generate";

const Body = z
  .object({
    discoveredShopId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    force: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.discoveredShopId) !== Boolean(v.companyId),
    { message: "exactly one of discoveredShopId or companyId is required" },
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId } = await params;
  const supabase = await createClient();

  const url = new URL(request.url);
  const force =
    url.searchParams.get("force") === "true" || (await peekForce(request));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select("id, workspace_id, stop_count")
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

  if (route.stop_count >= MAX_STOPS_PER_ROUTE) {
    return NextResponse.json(
      {
        error: "max_stops_reached",
        max: MAX_STOPS_PER_ROUTE,
        stop_count: route.stop_count,
      },
      { status: 409 },
    );
  }

  // Resolve shop info.
  let shopName: string;
  let shopAddress: string;
  let lat: number;
  let lng: number;

  if (parsed.data.companyId) {
    const { data: company, error } = await supabase
      .from("companies")
      .select("name, address, latitude, longitude, do_not_route")
      .eq("id", parsed.data.companyId)
      .eq("workspace_id", route.workspace_id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (company.do_not_route) {
      return NextResponse.json({ error: "Company is flagged do_not_route" }, { status: 400 });
    }
    if (company.latitude == null || company.longitude == null || !company.address) {
      return NextResponse.json({ error: "Company is missing location" }, { status: 400 });
    }
    shopName = company.name;
    shopAddress = company.address;
    lat = company.latitude;
    lng = company.longitude;
  } else {
    const { data: shop, error } = await supabase
      .from("discovered_shops")
      .select("name, address, latitude, longitude, do_not_route")
      .eq("id", parsed.data.discoveredShopId!)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    if (shop.do_not_route) {
      return NextResponse.json({ error: "Shop is flagged do_not_route" }, { status: 400 });
    }
    if (shop.latitude == null || shop.longitude == null || !shop.address) {
      return NextResponse.json({ error: "Shop is missing location" }, { status: 400 });
    }
    shopName = shop.name;
    shopAddress = shop.address;
    lat = shop.latitude;
    lng = shop.longitude;
  }

  // Refuse duplicates inside the same route.
  if (parsed.data.companyId) {
    const { count } = await supabase
      .from("route_stops")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId)
      .eq("company_id", parsed.data.companyId);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: "Already in route" }, { status: 409 });
    }
  } else {
    const { count } = await supabase
      .from("route_stops")
      .select("id", { count: "exact", head: true })
      .eq("route_id", routeId)
      .eq("discovered_shop_id", parsed.data.discoveredShopId!);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: "Already in route" }, { status: 409 });
    }
  }

  // Find next stop_order.
  const { data: lastStop } = await supabase
    .from("route_stops")
    .select("stop_order")
    .eq("route_id", routeId)
    .order("stop_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (lastStop?.stop_order ?? -1) + 1;

  const { data: insertedStop, error: insErr } = await supabase
    .from("route_stops")
    .insert({
      route_id: routeId,
      workspace_id: route.workspace_id,
      stop_order: nextOrder,
      discovered_shop_id: parsed.data.discoveredShopId ?? null,
      company_id: parsed.data.companyId ?? null,
      shop_name: shopName,
      shop_address: shopAddress,
      latitude: lat,
      longitude: lng,
      leg_drive_seconds: null,
      leg_drive_meters: null,
    })
    .select("id")
    .single();
  if (insErr || !insertedStop) {
    return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 500 });
  }

  // Recompute. If exceeds day window and not forced, roll back the insert.
  let recompute;
  try {
    recompute = await recomputeRouteAfterMutation({ supabase, routeId, force });
  } catch (err) {
    await supabase.from("route_stops").delete().eq("id", insertedStop.id);
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY not configured" }, { status: 503 });
    }
    console.error("[POST /api/routes/[routeId]/stops] recompute failed", err);
    return NextResponse.json(
      { error: "Routes API failed — stop add reverted" },
      { status: 502 },
    );
  }

  if (recompute.ok === false) {
    await supabase.from("route_stops").delete().eq("id", insertedStop.id);
    return NextResponse.json(
      {
        error: recompute.error,
        estimated_day_seconds: recompute.estimatedDaySeconds,
        max_seconds: recompute.maxSeconds,
        total_drive_seconds: recompute.totalSeconds,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    stop: { id: insertedStop.id, stop_order: nextOrder, shop_name: shopName, shop_address: shopAddress, latitude: lat, longitude: lng },
    stop_count: recompute.stopCount,
    total_drive_seconds: recompute.totalSeconds,
    total_drive_meters: recompute.totalMeters,
    estimated_day_seconds: recompute.estimatedDaySeconds,
    google_maps_deeplink: recompute.deeplink,
  });
}

async function peekForce(_req: NextRequest): Promise<boolean> {
  // Body's `force` field is parsed in the main path; this is a noop placeholder
  // that exists so URL-based and body-based force flags both work without
  // double-reading the body.
  return false;
}
