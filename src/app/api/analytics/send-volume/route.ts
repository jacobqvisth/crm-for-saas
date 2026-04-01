import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface SendVolumeEntry {
  date: string;
  sent: number;
  bounced: number;
  replied: number;
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceId = memberships[0].workspace_id;

  // Build last-30-days date range
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  // Get all sent emails in the last 30 days
  const { data: queueItems } = await supabase
    .from("email_queue")
    .select("id, tracking_id, sent_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .gte("sent_at", thirtyDaysAgo.toISOString())
    .not("sent_at", "is", null);

  if (!queueItems || queueItems.length === 0) {
    // Return empty 30-day series
    const series: SendVolumeEntry[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      series.push({ date: d.toISOString().slice(0, 10), sent: 0, bounced: 0, replied: 0 });
    }
    return NextResponse.json(series);
  }

  const trackingIds = queueItems.map((q) => q.tracking_id).filter(Boolean);

  // Get bounce and reply events for these tracking IDs
  const { data: events } = await supabase
    .from("email_events")
    .select("tracking_id, event_type, created_at")
    .in("tracking_id", trackingIds)
    .in("event_type", ["bounce", "reply"]);

  // Build per-tracking-id event map
  const bounceSet = new Set<string>();
  const replySet = new Set<string>();
  for (const ev of events || []) {
    if (ev.event_type === "bounce") bounceSet.add(ev.tracking_id);
    if (ev.event_type === "reply") replySet.add(ev.tracking_id);
  }

  // Aggregate by date
  const sentByDate = new Map<string, number>();
  const bouncedByDate = new Map<string, number>();
  const repliedByDate = new Map<string, number>();

  for (const q of queueItems) {
    if (!q.sent_at) continue;
    const date = q.sent_at.slice(0, 10);
    sentByDate.set(date, (sentByDate.get(date) ?? 0) + 1);
    if (bounceSet.has(q.tracking_id)) {
      bouncedByDate.set(date, (bouncedByDate.get(date) ?? 0) + 1);
    }
    if (replySet.has(q.tracking_id)) {
      repliedByDate.set(date, (repliedByDate.get(date) ?? 0) + 1);
    }
  }

  // Build 30-day series filling gaps with 0
  const series: SendVolumeEntry[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    series.push({
      date,
      sent: sentByDate.get(date) ?? 0,
      bounced: bouncedByDate.get(date) ?? 0,
      replied: repliedByDate.get(date) ?? 0,
    });
  }

  return NextResponse.json(series);
}
