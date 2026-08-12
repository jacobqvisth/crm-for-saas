import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ingestAgentConversation } from "@/lib/call-agent/process";
import type { ProviderConversation } from "@/lib/call-agent/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/call-agent/webhook — ElevenLabs post-call webhook. Delivers the
 * transcript + analysis when a conversation finishes; we match it to our
 * call_session and run the authoritative ingest pipeline.
 *
 * PUBLIC route: authenticated by ?token= (shared secret) and, when ElevenLabs
 * signs the payload (HMAC secret configured in their dashboard), by the
 * ElevenLabs-Signature header over the raw body. Either check passing is
 * enough — the collector cron is the belt-and-braces fallback anyway.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const token = request.nextUrl.searchParams.get("token");
  const service = createServiceClient();

  const { data: settings } = token
    ? await service
        .from("call_agent_settings")
        .select("*")
        .eq("webhook_secret", token)
        .maybeSingle()
    : { data: null };

  let authed = Boolean(settings);
  // HMAC check (format: "t=<unix>,v0=<hex>", HMAC-SHA256 of `${t}.${body}`).
  if (!authed && settings?.webhook_secret) {
    const sig = request.headers.get("elevenlabs-signature");
    if (sig) {
      const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
      const t = parts.t;
      const v0 = parts.v0;
      if (t && v0) {
        const expected = createHmac("sha256", settings.webhook_secret)
          .update(`${t}.${raw}`)
          .digest("hex");
        try {
          authed = timingSafeEqual(Buffer.from(expected), Buffer.from(v0));
        } catch {
          authed = false;
        }
      }
    }
  }
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: { type?: string; data?: ProviderConversation } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (payload?.type !== "post_call_transcription" || !payload.data?.conversation_id) {
    // Audio/other event types: acknowledge and ignore.
    return NextResponse.json({ ok: true, ignored: payload?.type ?? "unknown" });
  }

  const conversation = payload.data;

  // Match: session already tagged with this conversation, else the most recent
  // live agent session (single-concurrency makes this safe).
  let sessionId: string | null = null;
  const { data: tagged } = await service
    .from("call_sessions")
    .select("id")
    .eq("provider_conversation_id", conversation.conversation_id)
    .maybeSingle();
  if (tagged) sessionId = tagged.id;

  if (!sessionId) {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: live } = await service
      .from("call_sessions")
      .select("id")
      .eq("initiated_by", "agent")
      .in("status", ["dialing", "in_progress", "completed"])
      .gte("started_at", tenMinAgo)
      .order("started_at", { ascending: false })
      .limit(1);
    sessionId = live?.[0]?.id ?? null;
  }
  if (!sessionId) return NextResponse.json({ ok: true, unmatched: true });

  const result = await ingestAgentConversation(service, sessionId, conversation);
  return NextResponse.json(result);
}
