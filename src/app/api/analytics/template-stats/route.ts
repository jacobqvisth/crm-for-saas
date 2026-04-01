import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface TemplateStatResult {
  templateId: string;
  sent: number;
  openRate: number;
  replyRate: number;
  clickRate: number;
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

  // Get all sequence steps with template_id for this workspace
  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("id, template_id")
    .not("template_id", "is", null);

  if (!steps || steps.length === 0) {
    return NextResponse.json([]);
  }

  const stepIds = steps.map((s) => s.id);

  // Get all sent email_queue entries for these steps in this workspace
  const { data: queueItems } = await supabase
    .from("email_queue")
    .select("id, step_id, tracking_id, status")
    .eq("workspace_id", workspaceId)
    .in("step_id", stepIds)
    .eq("status", "sent");

  if (!queueItems || queueItems.length === 0) {
    return NextResponse.json([]);
  }

  const trackingIds = queueItems.map((q) => q.tracking_id).filter(Boolean);

  // Get all events for these tracking IDs
  const { data: events } = await supabase
    .from("email_events")
    .select("tracking_id, event_type")
    .in("tracking_id", trackingIds);

  // Build a map: tracking_id → set of event types
  const eventMap = new Map<string, Set<string>>();
  for (const ev of events || []) {
    if (!eventMap.has(ev.tracking_id)) eventMap.set(ev.tracking_id, new Set());
    eventMap.get(ev.tracking_id)!.add(ev.event_type);
  }

  // Build a map: step_id → template_id
  const stepTemplateMap = new Map<string, string>();
  for (const s of steps) {
    if (s.template_id) stepTemplateMap.set(s.id, s.template_id);
  }

  // Aggregate per template
  const templateStats = new Map<
    string,
    { sent: number; opens: number; replies: number; clicks: number }
  >();

  for (const q of queueItems) {
    const templateId = stepTemplateMap.get(q.step_id);
    if (!templateId) continue;

    if (!templateStats.has(templateId)) {
      templateStats.set(templateId, { sent: 0, opens: 0, replies: 0, clicks: 0 });
    }
    const stat = templateStats.get(templateId)!;
    stat.sent += 1;

    const evTypes = eventMap.get(q.tracking_id);
    if (evTypes) {
      if (evTypes.has("open")) stat.opens += 1;
      if (evTypes.has("reply")) stat.replies += 1;
      if (evTypes.has("click")) stat.clicks += 1;
    }
  }

  const results: TemplateStatResult[] = Array.from(templateStats.entries()).map(
    ([templateId, stat]) => ({
      templateId,
      sent: stat.sent,
      openRate: stat.sent > 0 ? Math.round((stat.opens / stat.sent) * 100) : 0,
      replyRate: stat.sent > 0 ? Math.round((stat.replies / stat.sent) * 100) : 0,
      clickRate: stat.sent > 0 ? Math.round((stat.clicks / stat.sent) * 100) : 0,
    })
  );

  return NextResponse.json(results);
}
