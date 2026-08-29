import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dialJob } from "@/lib/call-agent/queue";
import { ingestAgentConversation } from "@/lib/call-agent/process";
import { providerApiKey } from "@/lib/call-agent/settings";
import { getConversation, listConversations } from "@/lib/call-agent/elevenlabs";
import { cronGate } from "@/lib/features";

// The call-agent worker. Two duties per tick:
//   1) DIAL   — claim due queued jobs and place calls (1 live call at a time:
//               quality beats throughput, and it keeps webhook correlation
//               unambiguous).
//   2) COLLECT — fetch finished conversations for sessions the post-call
//               webhook hasn't settled (the webhook is push; this is the pull
//               fallback so nothing is ever lost).
//
// Vercel invokes crons with GET; POST kept for manual triggering. (The
// phone-enrichment 405 lesson.)
export const maxDuration = 300;

const STUCK_AFTER_MIN = 30;

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const summary = { dialed: 0, skipped: 0, failed: 0, collected: 0, stuck: 0 };

  const { data: allSettings } = await service
    .from("call_agent_settings")
    .select("*")
    .eq("enabled", true);

  for (const settings of allSettings ?? []) {
    const agentIds = (settings.provider_agent_ids ?? {}) as Record<string, string>;
    const apiKey = providerApiKey(settings);

    // ---- COLLECT first: settle finished calls before dialing new ones. ----
    const { data: openSessions } = await service
      .from("call_sessions")
      .select("id, status, started_at, provider_conversation_id, agent_job_id")
      .eq("workspace_id", settings.workspace_id)
      .eq("initiated_by", "agent")
      // 'no_recording' belongs here: an agent call has no 46elks recording by
      // design (the audio lives at the provider), so the hangup webhook parks the
      // session there. Leaving it out meant a finished conversation was never
      // collected and its job sat at 'calling' forever — two real jobs were
      // stranded that way, with a successful 37 second transcript never imported.
      .in("status", ["dialing", "in_progress", "completed", "no_recording"])
      .order("started_at", { ascending: true })
      .limit(10);

    let liveCall = false;
    for (const session of openSessions ?? []) {
      const ageMin = (Date.now() - new Date(session.started_at).getTime()) / 60_000;

      if (apiKey) {
        try {
          let conversationId = session.provider_conversation_id;
          if (!conversationId && agentIds.default) {
            const startedUnix = Math.floor(new Date(session.started_at).getTime() / 1000) - 60;
            const candidates = await listConversations(apiKey, {
              agentId: agentIds.default,
              startAfterUnix: startedUnix,
            });
            // Oldest finished conversation not yet linked to a session. The
            // provider agent is shared with the inbound switchboard, so a
            // candidate may be an inbound call — those live in
            // switchboard_calls and must never be claimed for an outbound job.
            for (const c of candidates.reverse()) {
              if (c.status !== "done" && c.status !== "failed") continue;
              const { data: taken } = await service
                .from("call_sessions")
                .select("id")
                .eq("provider_conversation_id", c.conversation_id)
                .maybeSingle();
              if (taken) continue;
              const { data: switchboardCall } = await service
                .from("switchboard_calls")
                .select("id")
                .eq("provider_conversation_id", c.conversation_id)
                .maybeSingle();
              if (switchboardCall) continue;
              conversationId = c.conversation_id;
              break;
            }
          }
          if (conversationId) {
            const conversation = await getConversation(apiKey, conversationId);
            if (conversation.status === "done" || conversation.status === "failed") {
              const r = await ingestAgentConversation(service, session.id, conversation);
              if (r.ok) summary.collected += 1;
              continue;
            }
            liveCall = true; // still talking/processing
            continue;
          }
        } catch (err) {
          console.error("call-agent collect failed", session.id, err);
        }
      }

      if (session.status === "dialing" || session.status === "in_progress") {
        if (ageMin > STUCK_AFTER_MIN) {
          await service
            .from("call_sessions")
            .update({ status: "failed", error: "no conversation result within 30 min" })
            .eq("id", session.id);
          if (session.agent_job_id) {
            await service
              .from("call_agent_jobs")
              .update({
                status: "failed",
                error: "no conversation result within 30 min",
                finished_at: new Date().toISOString(),
              })
              .eq("id", session.agent_job_id);
          }
          summary.stuck += 1;
        } else {
          liveCall = true;
        }
      }
      // status === "completed" without a conversation yet: give the provider
      // up to STUCK_AFTER_MIN to publish, handled by the branches above.
    }

    // ---- DIAL: one live call at a time per workspace. ----------------------
    if (liveCall) continue;

    const { data: due } = await service
      .from("call_agent_jobs")
      .select("*")
      .eq("workspace_id", settings.workspace_id)
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(3);

    for (const job of due ?? []) {
      // Claim (flip to processing) so overlapping runs don't double-dial.
      const { data: claimed } = await service
        .from("call_agent_jobs")
        .update({ status: "processing" })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const result = await dialJob(service, settings, job);
      if (result.outcome === "dialed") {
        summary.dialed += 1;
        break; // one live call at a time
      }
      if (result.outcome === "skipped") summary.skipped += 1;
      else summary.failed += 1;
      // Rails-skips don't consume the dial slot; try the next job.
    }
  }

  return NextResponse.json(summary);
}

export async function GET(request: NextRequest) {
  // Feature gate. 200 rather than an error: a switched-off feature is not
  // a failure, and a cron that fails on a schedule buries the alert channel.
  const skip = await cronGate("call_agent");
  if (skip) return skip;

  return handle(request);
}

export async function POST(request: NextRequest) {
  // Feature gate. 200 rather than an error: a switched-off feature is not
  // a failure, and a cron that fails on a schedule buries the alert channel.
  const skip = await cronGate("call_agent");
  if (skip) return skip;

  return handle(request);
}
