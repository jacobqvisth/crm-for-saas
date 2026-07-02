import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/calls/stats — headline numbers for the Calls overview cards.
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 403 });
  const ws = membership.workspace_id;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).toISOString();

  const callBase = () =>
    supabase.from("activities").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).eq("type", "call");

  const [today, week, weekConnected, weekInterested, callbacksDue, openFeedback] =
    await Promise.all([
      callBase().gte("created_at", todayStart),
      callBase().gte("created_at", weekStart),
      callBase().gte("created_at", weekStart).eq("metadata->>connected", "true"),
      callBase().gte("created_at", weekStart).eq("outcome", "interested"),
      supabase.from("tasks").select("id", { count: "exact", head: true })
        .eq("workspace_id", ws).eq("type", "call").is("completed_at", null),
      supabase.from("call_feedback").select("id", { count: "exact", head: true })
        .eq("workspace_id", ws).eq("status", "new"),
    ]);

  const weekCount = week.count ?? 0;
  const connectedCount = weekConnected.count ?? 0;

  return NextResponse.json({
    callsToday: today.count ?? 0,
    callsThisWeek: weekCount,
    connectRate: weekCount > 0 ? Math.round((connectedCount / weekCount) * 100) : 0,
    interestedThisWeek: weekInterested.count ?? 0,
    callbacksDue: callbacksDue.count ?? 0,
    openFeedback: openFeedback.count ?? 0,
  });
}
