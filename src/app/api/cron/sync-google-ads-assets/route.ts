// Daily Vercel cron at 05:20 UTC (see vercel.json). Pulls per-asset Google Ads
// performance — headlines, descriptions, images, videos, sitelinks — into
// dashboard_ad_asset_* for /dashboard/best-ads. Same SYNC_SECRET / CRON_SECRET
// Bearer auth as the rest of /api/cron/*.
//
// `?days=` overrides the lookback. The default reaches back far enough to keep
// the account's paused campaigns in frame, because the most useful lesson on
// the page (a campaign that bought 13,505 clicks and converted none of them) is
// entirely historical.

import { NextResponse, type NextRequest } from "next/server";
import { syncBestAds } from "@/lib/ceo/best-ads/sync";
import { cronGate } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The full-history pull is four paged Google Ads reports and ~19k upserted
// rows. Measured at well under a minute, but the default 10s would never
// finish, and a truncated sync writes a page that looks merely disappointing
// rather than broken.
export const maxDuration = 300;

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
  const daysParam = url.searchParams.get("days");
  const lookbackDays = daysParam
    ? Math.max(1, Math.min(1200, Number.parseInt(daysParam, 10) || 900))
    : undefined;

  const result = await syncBestAds(lookbackDays ? { lookbackDays } : undefined);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Gated on the same feature that owns the whole /dashboard suite, so the sync
// and the page it feeds switch together. 200 rather than an error: a switched-
// off feature is not a failure, and a cron that fails on a schedule buries the
// alert channel.
//
// Vercel cron always issues GET, so a cron route that only exports POST is a
// cron that never runs.
export async function GET(request: NextRequest) {
  const skip = await cronGate("product_analytics");
  if (skip) return skip;

  return run(request);
}

export async function POST(request: NextRequest) {
  const skip = await cronGate("product_analytics");
  if (skip) return skip;

  return run(request);
}
