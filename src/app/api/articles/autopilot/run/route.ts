// POST /api/articles/autopilot/run -> run one autopilot turn now, by hand.
//
// This is the "Run one now" button. It exists because switching a publisher on
// and finding out at 08:00 tomorrow whether the pipeline works is a bad trade:
// the whole path (pick a topic, write it, classify it, render a hero, push it to
// Webflow) should be provable on demand, before the schedule is armed.
//
// { force: true } skips the clock but nothing else. Webflow still has to be
// configured, a usable topic still has to exist, and the result is still written
// to the run log, marked trigger='manual' so a test is never mistaken for the
// schedule having fired.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { runAutopilotOnce } from "@/lib/articles/autopilot-run";

// Generation is the long pole: Opus 5 with retries, then a publish and a hero
// render. Same headroom as the Studio's generate route.
export const maxDuration = 300;

const bodySchema = z.object({ force: z.boolean().default(true) });

export async function POST(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const force = parsed.success ? parsed.data.force : true;

  const result = await runAutopilotOnce({
    supabase,
    workspaceId,
    trigger: "manual",
    ignoreSchedule: force,
  });

  // A skip or a failure is a legitimate answer to "run one now", not an HTTP
  // error: the caller asked what would happen and this is what happened.
  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
