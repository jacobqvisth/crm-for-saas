import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: accounts, error } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, display_name, daily_sends_count, max_daily_sends, status")
    .eq("workspace_id", workspaceId)
    .order("daily_sends_count", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }

  const formatted = (accounts || []).map((a) => ({
    id: a.id,
    email_address: a.email_address,
    display_name: a.display_name,
    daily_sends_count: a.daily_sends_count,
    max_daily_sends: a.max_daily_sends,
    remaining_capacity: Math.max(0, a.max_daily_sends - a.daily_sends_count),
    status: a.status,
  }));

  return NextResponse.json({ accounts: formatted });
}
