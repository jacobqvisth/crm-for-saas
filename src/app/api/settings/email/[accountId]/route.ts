import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ accountId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  const { accountId } = await context.params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify account belongs to user's workspace
  const { data: account } = await supabase
    .from("gmail_accounts")
    .select("id, workspace_id")
    .eq("id", accountId)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Verify user is a member of that workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { max_daily_sends, status, pause_reason } = body as {
    max_daily_sends?: number;
    status?: string;
    pause_reason?: string;
  };

  const update: Record<string, unknown> = {};
  if (max_daily_sends !== undefined) update.max_daily_sends = max_daily_sends;
  if (status !== undefined) {
    update.status = status;
    // When resuming, clear pause_reason
    if (status === "active") update.pause_reason = null;
  }
  if (pause_reason !== undefined) update.pause_reason = pause_reason;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("gmail_accounts")
    .update(update)
    .eq("id", accountId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
