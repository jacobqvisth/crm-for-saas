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
  const {
    max_daily_sends,
    status,
    pause_reason,
    warmup_stage,
    warmup_day,
    target_daily_sends,
    signature,
    display_name,
    warmup_enabled,
    warmup_start_date,
  } = body as {
    max_daily_sends?: number;
    status?: string;
    pause_reason?: string;
    warmup_stage?: string;
    warmup_day?: number;
    target_daily_sends?: number;
    signature?: string;
    display_name?: string;
    warmup_enabled?: boolean;
    warmup_start_date?: string;
  };

  const update: Record<string, unknown> = {};
  if (max_daily_sends !== undefined) {
    if (max_daily_sends < 1 || max_daily_sends > 500) {
      return NextResponse.json({ error: "max_daily_sends must be 1–500" }, { status: 400 });
    }
    update.max_daily_sends = max_daily_sends;
  }
  if (status !== undefined) {
    update.status = status;
    if (status === "active") update.pause_reason = null;
  }
  if (pause_reason !== undefined) update.pause_reason = pause_reason;
  if (warmup_stage !== undefined) {
    if (!["ramp", "graduated", "manual"].includes(warmup_stage)) {
      return NextResponse.json({ error: "warmup_stage must be ramp, graduated, or manual" }, { status: 400 });
    }
    update.warmup_stage = warmup_stage;
  }
  if (warmup_day !== undefined) {
    if (!Number.isInteger(warmup_day) || warmup_day < 0) {
      return NextResponse.json({ error: "warmup_day must be an integer >= 0" }, { status: 400 });
    }
    update.warmup_day = warmup_day;
  }
  if (target_daily_sends !== undefined) {
    if (target_daily_sends < 1 || target_daily_sends > 500) {
      return NextResponse.json({ error: "target_daily_sends must be 1–500" }, { status: 400 });
    }
    update.target_daily_sends = target_daily_sends;
  }
  if (signature !== undefined) update.signature = signature;
  if (display_name !== undefined) update.display_name = display_name;
  if (warmup_enabled !== undefined) update.warmup_enabled = warmup_enabled;
  if (warmup_start_date !== undefined) update.warmup_start_date = warmup_start_date;

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
