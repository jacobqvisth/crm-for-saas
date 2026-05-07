import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateDailyRoutes } from "@/lib/routes/generate";
import { MissingApiKeyError } from "@/lib/routes/geocode";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: string;
    originOverride?: { address: string; lat: number; lng: number };
  };

  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const origin =
    body.originOverride ??
    {
      address: process.env.ROUTE_DEFAULT_ORIGIN_ADDRESS ?? "Markvägen 23, 162 71 Vällingby",
      lat: Number(process.env.ROUTE_DEFAULT_ORIGIN_LAT ?? "59.3625"),
      lng: Number(process.env.ROUTE_DEFAULT_ORIGIN_LNG ?? "17.8722"),
    };

  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return NextResponse.json(
      { error: "ROUTE_DEFAULT_ORIGIN_LAT/LNG not configured and no override provided" },
      { status: 503 },
    );
  }

  // Use the service client for the heavy lift — RLS is enforced via the workspace membership
  // check above, and the generator needs to read both pools (cold = discovered_shops which
  // exists outside the user's RLS scope in some cases) and write daily_routes/route_stops.
  const service = createServiceClient();

  try {
    const summary = await generateDailyRoutes({
      workspaceId,
      origin,
      generatedBy: user.id,
      supabase: service,
    });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[/api/routes/generate]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }
}
