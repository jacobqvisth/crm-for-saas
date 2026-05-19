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

// Tracked sending domains. Add new ones here as you stand up additional
// sender identities. Each domain produces one row per cron run in
// dashboard_domain_health_checks and is regressed against its own
// previous row for alerting.
const DEFAULT_DOMAINS = ["wrenchlane.com", "wrenchlane.co"] as const;

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
  // Allow callers to override the domain set via `?domain=foo.com,bar.com`
  // (useful for one-off troubleshooting). Default to the constant list.
  const override = url.searchParams.get("domain");
  const domains = override
    ? override.split(",").map((d) => d.trim()).filter(Boolean)
    : [...DEFAULT_DOMAINS];

  const startedAt = new Date().toISOString();
  const supabase = createServiceClient();

  const results = await Promise.all(
    domains.map(async (domain) => {
      try {
        const current = await runDomainHealthCheck(supabase, { domain });
        const previous = await getPreviousCheck(
          supabase,
          domain,
          current.checked_at,
        );
        const notify = await notifyDomainHealth(current, previous);
        return {
          domain,
          ok: true as const,
          check: current,
          previous_status: previous?.status ?? null,
          notify,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          domain,
          ok: false as const,
          error: message,
        };
      }
    }),
  );

  const anyFailed = results.some((r) => !r.ok);
  return NextResponse.json(
    {
      status: anyFailed ? "partial" : "ok",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      domains: results,
    },
    { status: anyFailed ? 207 : 200 },
  );
}

export async function POST(request: NextRequest) {
  return run(request);
}

export async function GET(request: NextRequest) {
  return run(request);
}
