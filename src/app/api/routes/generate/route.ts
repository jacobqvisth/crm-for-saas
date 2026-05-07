import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateDailyRoutes } from "@/lib/routes/generate";
import { MissingApiKeyError } from "@/lib/routes/geocode";
import { getUserOrigin } from "@/lib/routes/profile";

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
    forUserId?: string;
  };

  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // forUserId is admin-only. If absent, the calling user is the assignee.
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

  // Resolve origin: explicit override → assignee's user_profiles → env defaults.
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
    const summary = await generateDailyRoutes({
      workspaceId,
      origin,
      generatedBy: user.id,
      assignedTo: assignedUserId,
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
