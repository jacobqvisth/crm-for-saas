import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AiSettings = {
  icp_prompt: string | null;
  filter_enabled: boolean;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const { data } = await (supabase as any)    .from("workspace_ai_settings")
    .select("icp_prompt, filter_enabled")
    .eq("workspace_id", membership.workspace_id)
    .single() as { data: AiSettings | null };

  if (!data) {
    return NextResponse.json({ icp_prompt: null, filter_enabled: true });
  }

  return NextResponse.json({
    icp_prompt: data.icp_prompt,
    filter_enabled: data.filter_enabled,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const body = await request.json();
  const { icp_prompt, filter_enabled } = body as {
    icp_prompt: string;
    filter_enabled: boolean;
  };

  const { error } = await (supabase as any)    .from("workspace_ai_settings")
    .upsert(
      { workspace_id: membership.workspace_id, icp_prompt, filter_enabled },
      { onConflict: "workspace_id" }
    ) as { error: { message: string } | null };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
