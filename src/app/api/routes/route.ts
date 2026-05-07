import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const status = searchParams.get("status");
  const batch = searchParams.get("batch");
  const scope = searchParams.get("scope") ?? "mine";

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

  let query = supabase
    .from("daily_routes")
    .select(
      "id, generated_at, generated_by, assigned_to, generation_batch_id, mode, mode_fallback_reason, cluster_label, scheduled_for, status, stop_count, total_drive_seconds, total_drive_meters, estimated_day_seconds, google_maps_deeplink",
    )
    .eq("workspace_id", workspaceId)
    .order("generated_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (batch) query = query.eq("generation_batch_id", batch);
  if (scope === "mine") {
    query = query.or(`assigned_to.eq.${user.id},assigned_to.is.null`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ routes: data ?? [] });
}
