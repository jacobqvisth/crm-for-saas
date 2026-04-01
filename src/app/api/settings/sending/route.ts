import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceSendingSettings } from "@/lib/database.types";

async function getWorkspaceId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .single();
  return data?.workspace_id ?? null;
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("sending_settings")
    .eq("id", workspaceId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const defaults: WorkspaceSendingSettings = {
    default_max_daily_sends: 50,
    bounce_threshold: 8,
  };

  const settings = {
    ...defaults,
    ...((workspace?.sending_settings as WorkspaceSendingSettings) || {}),
  };

  return NextResponse.json(settings);
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const body = await request.json();
  const { default_max_daily_sends, bounce_threshold } = body as WorkspaceSendingSettings;

  // Fetch current settings to merge
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("sending_settings")
    .eq("id", workspaceId)
    .single();

  const current = (workspace?.sending_settings as WorkspaceSendingSettings) || {};
  const updated: WorkspaceSendingSettings = { ...current };

  if (default_max_daily_sends !== undefined) updated.default_max_daily_sends = default_max_daily_sends;
  if (bounce_threshold !== undefined) updated.bounce_threshold = bounce_threshold;

  const { error } = await supabase
    .from("workspaces")
    .update({ sending_settings: updated })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
