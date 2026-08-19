import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getConversation } from "@/lib/call-agent/elevenlabs";
import { SWITCHBOARD_KNOWLEDGE } from "@/lib/switchboard/knowledge";
import { analyzeSwitchboardCall, transcriptToText } from "@/lib/switchboard/analyze";
import { switchboardApiKey } from "@/lib/switchboard/settings";
import type { Json } from "@/lib/database.types";

// Pull finished switchboard conversations back into the CRM.
//
// Two jobs, and the first is the one that was missing entirely: the transcript of
// a call to the receptionist lived only at the provider, so nothing about what it
// actually said was visible here. The bridge now records the conversation id and
// this fetches the rest.
//
// The second job is the point of collecting at all: work out what the receptionist
// could not answer, so the knowledge document is driven by real calls rather than
// guesses. That list is surfaced on the Phone System page.
//
// Vercel invokes crons with GET; POST kept for manual triggering.
export const maxDuration = 300;

// How many calls to work through per tick. Each one is an API fetch plus a model
// call, so this is deliberately small; the backlog drains over a few minutes.
const BATCH = 5;
// Give the provider time to finish processing before asking for the transcript.
const SETTLE_MS = 60_000;

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const summary = { examined: 0, collected: 0, skipped: 0, failed: 0, gaps: 0 };

  const cutoff = new Date(Date.now() - SETTLE_MS).toISOString();
  const { data: calls } = await service
    .from("switchboard_calls")
    .select("id, workspace_id, provider_conversation_id, created_at")
    .is("collected_at", null)
    .not("provider_conversation_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (!calls?.length) return NextResponse.json(summary);

  // Knowledge is per workspace and the batch is usually one workspace, so cache it.
  const knowledgeByWorkspace = new Map<string, string>();

  for (const call of calls) {
    summary.examined += 1;
    try {
      const { data: settings } = await service
        .from("switchboard_settings")
        .select("*")
        .eq("workspace_id", call.workspace_id)
        .maybeSingle();
      if (!settings) {
        summary.skipped += 1;
        continue;
      }

      const apiKey = await switchboardApiKey(service, settings);
      if (!apiKey) {
        summary.skipped += 1;
        continue;
      }

      const convo = await getConversation(apiKey, call.provider_conversation_id!);
      // Still processing at the provider: leave it for the next tick rather than
      // storing a half-written transcript.
      if (convo.status && !["done", "failed"].includes(convo.status)) {
        summary.skipped += 1;
        continue;
      }

      const text = transcriptToText(convo.transcript);

      let knowledgeMd = knowledgeByWorkspace.get(call.workspace_id);
      if (knowledgeMd === undefined) {
        // Same resolution as provisioning, so the analysis judges the agent
        // against exactly the document it was given.
        knowledgeMd = settings.knowledge_md?.trim() || SWITCHBOARD_KNOWLEDGE;
        knowledgeByWorkspace.set(call.workspace_id, knowledgeMd);
      }

      const update: Record<string, Json | string | null> = {
        transcript: (convo.transcript ?? []) as unknown as Json,
        collected_at: new Date().toISOString(),
      };

      // The provider writes its own summary; prefer our analysis when we get one,
      // since it is written for the team rather than for the provider's dashboard.
      let analysed = false;
      if (text) {
        const result = await analyzeSwitchboardCall({ transcript: text, knowledgeMd });
        if (result.ok) {
          analysed = true;
          update.summary = result.analysis.summary || null;
          update.unanswered = result.analysis.unanswered.length
            ? result.analysis.unanswered
            : null;
          summary.gaps += result.analysis.unanswered.length;
          if (result.analysis.suspect_claims.length) {
            // Worth shouting about: the receptionist asserted something that is not
            // in its knowledge, which means a caller was told something untrue.
            console.warn(
              `switchboard call ${call.id}: suspect claims`,
              result.analysis.suspect_claims,
            );
          }
        } else {
          console.error(`switchboard analysis failed for ${call.id}: ${result.reason}`);
        }
      }
      if (!analysed && convo.analysis?.transcript_summary) {
        update.summary = convo.analysis.transcript_summary;
      }

      const { error } = await service
        .from("switchboard_calls")
        .update(update)
        .eq("id", call.id);
      if (error) throw new Error(error.message);

      summary.collected += 1;
    } catch (err) {
      summary.failed += 1;
      console.error("switchboard-collect failed for", call.id, err);
      // Mark it collected anyway on a hard failure, so one broken conversation
      // cannot block the queue forever. The transcript stays absent, which is
      // visible, rather than the cron silently spinning on it every tick.
      await service
        .from("switchboard_calls")
        .update({ collected_at: new Date().toISOString() })
        .eq("id", call.id);
    }
  }

  return NextResponse.json(summary);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
