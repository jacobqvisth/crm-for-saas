// Daily Vercel/pg_cron route. Runs shortly after `discover-new-wl-users` so it
// operates on freshly-inserted signup contacts. Re-derives
// contacts.attributed_to_* for every app-user contact still missing a linked
// send, using self / company / phone matching (see reconcile-attribution.ts).
//
// Idempotent: only touches rows where attributed_to_send_id IS NULL.
//
// Auth: same `SYNC_SECRET` (or `CRON_SECRET`) Bearer header as the other cron
// routes. Pass `?dry-run=1` to report counts without writing.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { reconcileWlAttribution } from "@/lib/wl-sync/reconcile-attribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
  const dryRun =
    url.searchParams.get("dry-run") === "1" ||
    url.searchParams.get("dry-run") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const startedAt = new Date().toISOString();
  try {
    const supabase = createServiceClient();
    const result = await reconcileWlAttribution(supabase, { dryRun, limit });
    const finishedAt = new Date().toISOString();
    return NextResponse.json({
      status: "ok",
      dry_run: dryRun,
      started_at: startedAt,
      finished_at: finishedAt,
      ...result,
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
