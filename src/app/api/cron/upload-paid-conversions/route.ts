// Daily Vercel cron at 05:50 UTC (see vercel.json). Sends workshops Stripe has
// actually charged back to Google Ads as offline conversions, so the ad account
// can eventually be judged on revenue rather than on signups.
//
// Inert until set up. Without GOOGLE_DATAMANAGER_REFRESH_TOKEN and
// GOOGLE_ADS_PAID_SUBSCRIPTION_ACTION_ID it answers 200 with `skipped` and a
// reason, because a cron that fails on a schedule buries the alert channel.
// `scripts/google-datamanager-setup.mjs` produces both.
//
// `?dryRun=1` runs every read and Google's own server-side validation, then
// stops before writing anything or recording a ledger row. Use it first.

import { NextResponse, type NextRequest } from "next/server";
import { uploadPaidSubscriptions } from "@/lib/ceo/paying-customers/upload";
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
  const dryRun = url.searchParams.get("dryRun") === "1";

  const result = await uploadPaidSubscriptions({ dryRun });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

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
