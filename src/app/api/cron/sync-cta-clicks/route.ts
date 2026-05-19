// Daily Vercel cron at 06:30 UTC (see vercel.json). Fetches the last 7
// days of GA4 cta_click rollups and upserts into dashboard_cta_clicks
// for fast queries on /ceo/cta-clicks. Same SYNC_SECRET / CRON_SECRET
// Bearer auth as the rest of /api/cron/* and /api/ceo-sync/*.

import { NextResponse, type NextRequest } from "next/server";
import { syncCtaClicks } from "@/lib/ceo/sync/cta-clicks-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
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

  const url = new URL(request.url);
  const windowDaysParam = url.searchParams.get("days");
  const windowDays = windowDaysParam
    ? Math.max(1, Math.min(365, Number.parseInt(windowDaysParam, 10) || 7))
    : 7;

  const result = await syncCtaClicks({ windowDays });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
