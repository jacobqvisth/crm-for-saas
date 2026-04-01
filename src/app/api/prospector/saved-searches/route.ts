import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Json } from "@/lib/database.types";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: searches, error } = await supabase
    .from("prospector_saved_searches")
    .select("id, name, filters, last_run_at, result_count, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ searches: searches || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: {
    name: string;
    filters: Record<string, unknown>;
    workspaceId: string;
    resultCount?: number;
  } = await request.json();
  const { name, filters, workspaceId, resultCount } = body;

  if (!workspaceId || !name?.trim()) {
    return NextResponse.json({ error: "name and workspaceId are required" }, { status: 400 });
  }

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: search, error } = await supabase
    .from("prospector_saved_searches")
    .insert({
      workspace_id: workspaceId,
      name: name.trim(),
      filters: filters as Json,
      result_count: resultCount ?? null,
    })
    .select("id, name, filters, last_run_at, result_count, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ search });
}
