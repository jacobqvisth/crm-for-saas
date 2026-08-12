import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/call-agent/hangup — 46elks whenhangup callback for agent calls.
 * Marks the telephony leg finished (duration, ended_at). The transcript
 * arrives separately via the ElevenLabs post-call webhook or the collector.
 *
 * PUBLIC route: 46elks sends no auth headers; the shared secret rides the URL
 * (?token=), same pattern as the existing /api/calls/webhook routes.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const sessionId = request.nextUrl.searchParams.get("session");
  if (!token || !sessionId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const service = createServiceClient();
  const { data: settings } = await service
    .from("call_agent_settings")
    .select("workspace_id")
    .eq("webhook_secret", token)
    .maybeSingle();
  if (!settings) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 46elks posts application/x-www-form-urlencoded.
  const form = await request.formData().catch(() => null);
  const duration = form?.get("duration");
  const durationSecs = duration ? Number(duration) : null;

  const { data: session } = await service
    .from("call_sessions")
    .select("id, status, workspace_id")
    .eq("id", sessionId)
    .eq("workspace_id", settings.workspace_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ ok: true, unmatched: true });

  // Only move forward: a session the webhook already processed stays processed.
  if (session.status === "dialing" || session.status === "in_progress") {
    await service
      .from("call_sessions")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        ...(durationSecs != null && Number.isFinite(durationSecs)
          ? { duration_seconds: durationSecs }
          : {}),
      })
      .eq("id", session.id);
  }

  return NextResponse.json({ ok: true });
}
