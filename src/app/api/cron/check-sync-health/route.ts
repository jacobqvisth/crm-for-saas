// Daily Vercel cron at 08:00 UTC (see vercel.json). Surfaces sync failures
// and stale sources via Slack (if SLACK_ALERT_WEBHOOK_URL is set) or
// console.error otherwise. Sister to the rest of the /api/cron/* routes —
// same SYNC_SECRET / CRON_SECRET Bearer auth.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkSyncHealth, notifySyncHealth } from "@/lib/ceo/sync/health-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const startedAt = new Date().toISOString();
  try {
    const supabase = createServiceClient();
    const result = await checkSyncHealth(supabase);
    const notify = await notifySyncHealth(result);
    return NextResponse.json({
      status: "ok",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      health: result,
      notify,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: message, started_at: startedAt },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return run(request);
}

export async function GET(request: NextRequest) {
  return run(request);
}
