// Daily Vercel cron at 08:30 UTC (see vercel.json). Snapshots DNS auth +
// blocklist status + 24h send-health metrics for the sending domain into
// dashboard_domain_health_checks, then notifies via SLACK_ALERT_WEBHOOK_URL
// if the status regressed. Sister to /api/cron/check-sync-health — same
// auth pattern.

import { NextResponse, type NextRequest } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import {
  getPreviousCheck,
  runDomainHealthCheck,
} from "@/lib/domain-health";
import { notifyDomainHealth } from "@/lib/domain-health/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_DOMAIN = "wrenchlane.com";

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

  const url = new URL(request.url);
  const domain = url.searchParams.get("domain") ?? DEFAULT_DOMAIN;

  const startedAt = new Date().toISOString();
  try {
    const supabase = createServiceClient();
    const current = await runDomainHealthCheck(supabase, { domain });
    const previous = await getPreviousCheck(supabase, domain, current.checked_at);
    const notify = await notifyDomainHealth(current, previous);
    return NextResponse.json({
      status: "ok",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      check: current,
      previous_status: previous?.status ?? null,
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
