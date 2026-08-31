// Daily Vercel cron at 05:35 UTC (see vercel.json). Pulls Google Ads
// conversion-action config and daily conversion counts into
// dashboard_ad_conversion_* for /dashboard/paying-customers, which lines
// Google's claims up against what Stripe actually charged.
//
// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/*.

import { NextResponse, type NextRequest } from "next/server";
import { syncPayingCustomers } from "@/lib/ceo/paying-customers/sync";
import { cronGate } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    ? Math.max(1, Math.min(1200, Number.parseInt(daysParam, 10) || 400))
    : undefined;

  const result = await syncPayingCustomers(lookbackDays ? { lookbackDays } : undefined);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Gated on the feature that owns the /dashboard suite, so the sync and the page
// it feeds switch together. Vercel cron always issues GET.
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
