import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateRoute, type RegionKey } from "@/lib/routes/generate";
import { MissingApiKeyError } from "@/lib/routes/geocode";
import { getUserOrigin } from "@/lib/routes/profile";

export const maxDuration = 60;

const VALID_REGIONS: RegionKey[] = [
  "auto",
  "stockholm-north",
  "stockholm-south",
  "stockholm-east",
  "stockholm-west",
  "uppsala",
  "sodertalje",
  "malardalen-west",
  "norrtalje-area",
];

function isRegionKey(v: unknown): v is RegionKey {
  return typeof v === "string" && (VALID_REGIONS as string[]).includes(v);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: string;
    region?: string;
    forDate?: string;
    forUserId?: string;
    originOverride?: { address: string; lat: number; lng: number };
  };

  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const region: RegionKey = isRegionKey(body.region) ? body.region : "auto";
  const forDate = isIsoDate(body.forDate) ? body.forDate : null;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let assignedUserId = user.id;
  if (body.forUserId && body.forUserId !== user.id) {
    if (membership.role !== "admin") {
      return NextResponse.json({ error: "Only admins can generate for another user" }, { status: 403 });
    }
    const { data: target } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", body.forUserId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "forUserId is not a workspace member" }, { status: 400 });
    }
    assignedUserId = body.forUserId;
  }

  let origin: { address: string; lat: number; lng: number } | null = null;
  if (body.originOverride) {
    origin = body.originOverride;
  } else {
    const resolved = await getUserOrigin(assignedUserId, supabase);
    if (resolved) origin = { address: resolved.address, lat: resolved.lat, lng: resolved.lng };
  }

  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return NextResponse.json(
      { error: "No origin available — set one in /settings/profile or configure ROUTE_DEFAULT_ORIGIN_*" },
      { status: 503 },
    );
  }

  const service = createServiceClient();

  try {
    const result = await generateRoute({
      workspaceId,
      origin,
      generatedBy: user.id,
      assignedTo: assignedUserId,
      region,
      forDate,
      supabase: service,
    });

    if (!result.ok) {
      const status =
        result.error === "unavailable_date"
          ? 409
          : result.error === "routes_api_failed" || result.error === "persist_failed"
            ? 500
            : 400;
      return NextResponse.json(
        {
          error: result.error,
          reason: result.reason,
          diagnostics: result.diagnostics,
        },
        { status },
      );
    }

    return NextResponse.json({
      route: result.route,
      diagnostics: result.diagnostics,
    });
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
