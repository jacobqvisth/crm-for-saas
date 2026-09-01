// Hourly Vercel cron (see vercel.json). One turn of the Articles Autopilot.
//
// WHY HOURLY, WHEN THE CADENCE IS FIVE A DAY
// The cron expression is deliberately dumber than the schedule. Encoding
// "08:00, 10:00, 12:00, 14:00, 16:00" in cron would freeze the cadence into a
// deploy, would be in UTC rather than Stockholm (so it would shift by an hour
// twice a year), and still could not express "five a day". So this fires every
// hour and asks article_autopilot_settings what it is allowed to do. Nearly
// every invocation decides to do nothing, cheaply, and says why.
//
// It publishes at most ONE article per invocation. Generation can take minutes
// and the function ceiling is 300s; batching two into one call would risk losing
// the second to a timeout after it had already been written.
//
// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/*.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SHARED_ARTICLES_WORKSPACE_ID } from "@/lib/articles/server";
import { runAutopilotOnce } from "@/lib/articles/autopilot-run";
import { cronGate } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const explicit = request.headers.get("x-sync-secret");
  const provided = bearer || explicit;
  if (!syncSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAutopilotOnce({
    // Service role: there is no user session on a cron, and the run has to write
    // both an articles row and a run-log row.
    supabase: createServiceClient(),
    workspaceId: SHARED_ARTICLES_WORKSPACE_ID,
    trigger: "cron",
  });

  // A skip is the expected outcome most hours and must not read as a failure to
  // Vercel or the health checker. Only a genuine error is non-2xx.
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}

// Vercel crons issue a GET. Exporting only POST is the mistake that has made a
// cron route in this codebase silently never fire before.
export async function GET(request: NextRequest) {
  const skip = await cronGate("articles");
  if (skip) return skip;
  return run(request);
}

export async function POST(request: NextRequest) {
  const skip = await cronGate("articles");
  if (skip) return skip;
  return run(request);
}
