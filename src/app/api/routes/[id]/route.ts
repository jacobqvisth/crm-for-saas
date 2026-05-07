import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUnavailable } from "@/lib/routes/profile";

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>, routeId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: route, error } = await supabase
    .from("daily_routes")
    .select("workspace_id, assigned_to")
    .eq("id", routeId)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!route) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", route.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };

  return { user, workspaceId: route.workspace_id, assignedTo: route.assigned_to };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const auth = await authorize(supabase, id);
  if ("error" in auth) return auth.error;

  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select("*")
    .eq("id", id)
    .single();
  if (routeErr || !route) {
    return NextResponse.json({ error: routeErr?.message ?? "Not found" }, { status: 404 });
  }

  const { data: stops, error: stopsErr } = await supabase
    .from("route_stops")
    .select(
      "id, stop_order, discovered_shop_id, company_id, shop_name, shop_address, latitude, longitude, leg_drive_seconds, leg_drive_meters, visited_at, visit_outcome, visit_notes, follow_up_required, discovered_shops(name, address), companies(name, address)",
    )
    .eq("route_id", id)
    .order("stop_order", { ascending: true });
  if (stopsErr) {
    return NextResponse.json({ error: stopsErr.message }, { status: 500 });
  }

  return NextResponse.json({ route, stops: stops ?? [] });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const auth = await authorize(supabase, id);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const body = (await request.json().catch(() => ({}))) as {
    scheduled_for?: string | null;
    status?: "scheduled" | "discarded" | "in_progress" | "completed" | "candidate";
  };

  // Schedule guard — block dates that fall on the assignee's non-working day or a PTO entry,
  // unless `?force=true`.
  if (body.scheduled_for && !force) {
    const targetUserId = auth.assignedTo ?? auth.user.id;
    const reason = await isUnavailable(targetUserId, body.scheduled_for, supabase);
    if (reason) {
      return NextResponse.json(
        {
          error: "unavailable_date",
          reason: reason.kind,
          detail: reason.kind === "non_working_day"
            ? `Not a working day (${reason.day}) for the assignee.`
            : reason.reason ?? "PTO",
        },
        { status: 409 },
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (body.scheduled_for !== undefined) update.scheduled_for = body.scheduled_for;
  if (body.status !== undefined) update.status = body.status;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("daily_routes")
    .update(update)
    .eq("id", id)
    .select("id, scheduled_for, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ route: data });
}
