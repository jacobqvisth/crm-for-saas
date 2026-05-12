// Sync health surveillance.
//
// Background: the `core_app` sync was silently failing every run from
// 2026-05-04 through 2026-05-12 (8 days, ~16 failed runs) and we only
// noticed when an operator manually tried to find a recently-signed-up
// user that hadn't propagated to /contacts. The fix (PR #181) closes the
// underlying bug; this module closes the detection gap.
//
// Two failure modes worth catching:
//   1. Recent failed run — any `dashboard_sync_runs.status='failed'` in
//      the last 26h. Catches new regressions before they sit.
//   2. Stale last-success — for each source, if the most recent
//      successful run is older than the source's expected interval ×
//      tolerance, treat it as "the cron stopped firing". Catches cases
//      where pg_cron itself is paused or the schedule was changed
//      incorrectly.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SourceFreshness = {
  source_key: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_message: string | null;
  hours_since_success: number | null;
  expected_max_hours: number;
  stale: boolean;
};

export type HealthCheckResult = {
  recent_failures: Array<{
    source_key: string;
    started_at: string;
    error_message: string | null;
  }>;
  stale_sources: SourceFreshness[];
  ok: boolean;
};

// Expected freshness budget per source — tolerance is roughly 2× the
// scheduled cadence so an isolated missed run doesn't false-alarm. Sources
// not listed here aren't health-tracked.
const FRESHNESS_BUDGET_HOURS: Record<string, number> = {
  core_app: 18, // twice daily (02:25 / 10:25 UTC) → 8h gap, 18h tolerance
  ga4: 30, // daily 06:00 UTC → 24h gap, 30h tolerance
  google_ads: 30,
  search_console: 30,
  app_store_connect: 30,
  stripe: 3, // hourly → 1h gap, 3h tolerance
  customer_io: 3,
};

export async function checkSyncHealth(
  supabase: SupabaseClient,
): Promise<HealthCheckResult> {
  const now = Date.now();
  const cutoff = new Date(now - 26 * 3600 * 1000).toISOString();

  const { data: failures, error: fErr } = await supabase
    .from("dashboard_sync_runs")
    .select("source_key, started_at, error_message")
    .eq("status", "failed")
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false });
  if (fErr) throw fErr;

  // For each tracked source, find the most recent successful run.
  const stale: SourceFreshness[] = [];
  for (const [source_key, budget] of Object.entries(FRESHNESS_BUDGET_HOURS)) {
    const { data: lastSuccess } = await supabase
      .from("dashboard_sync_runs")
      .select("started_at")
      .eq("source_key", source_key)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1);

    const { data: lastFailure } = await supabase
      .from("dashboard_sync_runs")
      .select("started_at, error_message")
      .eq("source_key", source_key)
      .eq("status", "failed")
      .order("started_at", { ascending: false })
      .limit(1);

    const last_success_at = lastSuccess?.[0]?.started_at ?? null;
    const last_failure_at = lastFailure?.[0]?.started_at ?? null;
    const hours_since_success = last_success_at
      ? (now - new Date(last_success_at).getTime()) / 3600 / 1000
      : null;
    const is_stale =
      hours_since_success === null || hours_since_success > budget;

    if (is_stale) {
      stale.push({
        source_key,
        last_success_at,
        last_failure_at,
        last_failure_message: lastFailure?.[0]?.error_message ?? null,
        hours_since_success,
        expected_max_hours: budget,
        stale: true,
      });
    }
  }

  return {
    recent_failures: failures ?? [],
    stale_sources: stale,
    ok: (failures?.length ?? 0) === 0 && stale.length === 0,
  };
}

// Post a summary to Slack if SLACK_ALERT_WEBHOOK_URL is set. Falls back to
// console.error so the alert at least surfaces in Vercel logs (which Jacob
// already grep when investigating).
export async function notifySyncHealth(result: HealthCheckResult): Promise<{
  channel: "slack" | "console";
  sent: boolean;
}> {
  if (result.ok) return { channel: "console", sent: false };

  const lines: string[] = [];
  lines.push(`🚨 *crm-for-saas sync health*`);
  if (result.recent_failures.length > 0) {
    lines.push(`*${result.recent_failures.length} failed run(s) in last 26h:*`);
    for (const f of result.recent_failures.slice(0, 8)) {
      lines.push(`• \`${f.source_key}\` @ ${f.started_at} — ${f.error_message ?? "no message"}`);
    }
    if (result.recent_failures.length > 8) {
      lines.push(`…and ${result.recent_failures.length - 8} more`);
    }
  }
  if (result.stale_sources.length > 0) {
    lines.push(`*${result.stale_sources.length} stale source(s):*`);
    for (const s of result.stale_sources) {
      const h = s.hours_since_success?.toFixed(1) ?? "∞";
      lines.push(
        `• \`${s.source_key}\` — ${h}h since last success (budget ${s.expected_max_hours}h)`,
      );
    }
  }
  const text = lines.join("\n");

  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return { channel: "slack", sent: true };
      console.error(`[sync-health] Slack webhook failed status=${res.status}`);
    } catch (err) {
      console.error(`[sync-health] Slack webhook threw`, err);
    }
  }

  console.error(`[sync-health]\n${text}`);
  return { channel: "console", sent: true };
}
