// Daily Vercel cron (see vercel.json). Pulls review rating + count + recent
// reviews from each configured source (Trustpilot today; Google Business
// Profile once its API access is approved) and upserts into
// dashboard_review_snapshots + dashboard_reviews for /ceo/reviews.
//
// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/*.
// Optional ?source=trustpilot to run a single source.

import { NextResponse, type NextRequest } from "next/server";
import { syncReviews } from "@/lib/ceo/reviews/sync";

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
  const only = url.searchParams.get("source") ?? undefined;

  const result = await syncReviews(only);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
