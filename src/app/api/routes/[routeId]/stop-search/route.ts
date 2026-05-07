import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ICP_SHOP_TYPES = ["auto_repair", "tire_combo", "auto_glass", "auto_body"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId } = await params;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? "10")));

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: route } = await supabase
    .from("daily_routes")
    .select("workspace_id")
    .eq("id", routeId)
    .maybeSingle();
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", route.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ILIKE pattern (escape % and _)
  const safe = q.replace(/[%_]/g, "\\$&");
  const pattern = `%${safe}%`;

  const [companiesRes, discoveredRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, address, latitude, longitude, do_not_route, activated_at")
      .eq("workspace_id", route.workspace_id)
      .eq("do_not_route", false)
      .ilike("name", pattern)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(limit),
    supabase
      .from("discovered_shops")
      .select("id, name, address, latitude, longitude, country_code, shop_type, do_not_route")
      .eq("country_code", "SE")
      .eq("do_not_route", false)
      .in("shop_type", ICP_SHOP_TYPES)
      .ilike("name", pattern)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(limit),
  ]);

  if (companiesRes.error) return NextResponse.json({ error: companiesRes.error.message }, { status: 500 });
  if (discoveredRes.error) return NextResponse.json({ error: discoveredRes.error.message }, { status: 500 });

  const companies = (companiesRes.data ?? [])
    .filter((c) => c.address && c.latitude != null && c.longitude != null)
    .map((c) => ({
      kind: "company" as const,
      id: c.id,
      name: c.name,
      address: c.address!,
      lat: c.latitude!,
      lng: c.longitude!,
      mode: c.activated_at ? ("lapsed" as const) : ("cold" as const),
    }));

  const discovered = (discoveredRes.data ?? [])
    .filter((s) => s.address && s.latitude != null && s.longitude != null)
    .map((s) => ({
      kind: "discovered_shop" as const,
      id: s.id,
      name: s.name,
      address: s.address!,
      lat: s.latitude!,
      lng: s.longitude!,
      mode: "cold" as const,
    }));

  return NextResponse.json({ results: [...companies, ...discovered].slice(0, limit) });
}
