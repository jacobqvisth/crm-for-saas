// Daily Vercel cron route. Runs ~5 minutes after the second `core_app` sync
// firing (10:25 UTC, see `ceo-sync-core-app-twice-daily` pg_cron job) so it
// operates against freshly-written `dashboard_workshops` / `dashboard_users`
// data — specifically the `is_internal_test` exclusion flag.
//
// Auth: same `SYNC_SECRET` (or `CRON_SECRET`) Bearer header as `/api/ceo-sync/*`
// and `/api/cron/process-emails`. Vercel cron fires `Authorization: Bearer
// $CRON_SECRET` automatically; manual reruns use `SYNC_SECRET` for parity with
// the audit tooling.
//
// Sister to `src/lib/ceo/sync/propagate-to-crm.ts` (which UPDATEs already-linked
// rows). This route does the INSERT path: a new WL-app signup ends up here.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { discoverNewWlUsers } from "@/lib/wl-sync/discover-new";

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
    const result = await discoverNewWlUsers(supabase);
    const finishedAt = new Date().toISOString();
    return NextResponse.json({
      status: "ok",
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
