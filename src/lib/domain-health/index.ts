// Top-level orchestrator for the daily domain-health check.
//
// Combines the DNS snapshot, blocklist queries, and 24h send metrics into
// a single `DomainHealthCheck` record, applies threshold rules to produce
// a status and alert list, persists the row, and (separately) sends a
// Slack notification when status regressed since the previous run.

import type { SupabaseClient } from "@supabase/supabase-js";

import { snapshotDns, type DnsSnapshot } from "./dns";
import { checkBlocklists, type BlocklistResult } from "./dnsbl";
import { getSendMetrics, type SendMetrics } from "./metrics";

export type DomainHealthStatus = "ok" | "warning" | "critical";

export type DomainHealthCheck = {
  domain: string;
  checked_at: string;
  dns_records: DnsSnapshot;
  blocklists: BlocklistResult[];
  send_metrics: SendMetrics;
  status: DomainHealthStatus;
  alerts: string[];
  run_notes: string | null;
};

export type RunOptions = {
  domain: string;
  // Override the table name in tests.
  tableName?: string;
};

export const THRESHOLDS = {
  bounce_warning: 0.03,
  bounce_critical: 0.05,
  unsubscribe_warning: 0.02,
  volume_spike_warning: 3, // >3× rolling-7d average
} as const;

export function evaluate(
  domain: string,
  dns: DnsSnapshot,
  blocklists: BlocklistResult[],
  metrics: SendMetrics,
): { status: DomainHealthStatus; alerts: string[] } {
  const alerts: string[] = [];
  let severity: DomainHealthStatus = "ok";

  const bump = (next: DomainHealthStatus) => {
    if (severity === "critical") return;
    if (next === "critical") severity = "critical";
    else if (next === "warning" && severity === "ok") severity = "warning";
  };

  // DNS auth — a missing record is critical, anything sending mail
  // without one of these is at risk of being filtered as spam.
  if (!dns.spf.ok) {
    alerts.push(`SPF: ${dns.spf.note ?? "missing"}`);
    bump("critical");
  }
  if (!dns.dkim.ok) {
    alerts.push(`DKIM: ${dns.dkim.note ?? "missing"}`);
    bump("critical");
  }
  if (!dns.dmarc.ok) {
    alerts.push(`DMARC: ${dns.dmarc.note ?? "missing"}`);
    bump("critical");
  } else if (dns.dmarc.policy === "none") {
    alerts.push(
      `DMARC policy=none — receivers won't reject spoofs. Move to quarantine or reject when ready.`,
    );
    bump("warning");
  }

  // Blocklists — any confirmed listing is critical. Refused / error
  // states aren't promoted to alerts (we already log the rate-limit
  // gotcha at the lookup layer); the row's `blocklists` column still
  // carries the raw payload for the UI to show.
  for (const bl of blocklists) {
    if (bl.state === "listed") {
      alerts.push(`Blocklist hit: ${bl.list} — ${bl.note ?? bl.raw ?? "listed"}`);
      bump("critical");
    }
  }

  // Send health — Gmail's own signals.
  if (metrics.queue_failures > 0) {
    alerts.push(
      `${metrics.queue_failures} queue-level failure(s) in last 24h (Gmail rejected at API).`,
    );
    bump("warning");
  }
  if (metrics.bounce_rate >= THRESHOLDS.bounce_critical) {
    alerts.push(
      `Bounce rate ${(metrics.bounce_rate * 100).toFixed(2)}% (last 24h, ${metrics.bounces}/${metrics.sent}) — Gmail throttles at ≥5%.`,
    );
    bump("critical");
  } else if (metrics.bounce_rate >= THRESHOLDS.bounce_warning) {
    alerts.push(
      `Bounce rate ${(metrics.bounce_rate * 100).toFixed(2)}% (last 24h) — review list hygiene.`,
    );
    bump("warning");
  }
  if (metrics.unsubscribe_rate >= THRESHOLDS.unsubscribe_warning) {
    alerts.push(
      `Unsubscribe rate ${(metrics.unsubscribe_rate * 100).toFixed(2)}% (last 24h, ${metrics.unsubscribes}/${metrics.sent}) — message-market fit slipping.`,
    );
    bump("warning");
  }
  if (
    metrics.volume_vs_7d_avg >= THRESHOLDS.volume_spike_warning &&
    metrics.rolling_7d_avg_daily_volume >= 10 // ignore comparisons from a near-zero baseline
  ) {
    alerts.push(
      `Sent ${metrics.volume_vs_7d_avg.toFixed(1)}× the rolling 7-day average — possible runaway sequence?`,
    );
    bump("warning");
  }

  // Silence the unused-var path: `domain` is captured in alerts only if
  // we ever want to multi-domain in the future. Keep it in scope for
  // call-site clarity.
  void domain;

  return { status: severity, alerts };
}

export async function runDomainHealthCheck(
  supabase: SupabaseClient,
  opts: RunOptions,
): Promise<DomainHealthCheck> {
  const domain = opts.domain;
  const notes: string[] = [];

  const [dnsRes, blRes, metricsRes] = await Promise.allSettled([
    snapshotDns(domain),
    checkBlocklists(domain),
    getSendMetrics(supabase),
  ]);

  // We don't want a single check failing to wipe the whole record.
  // Capture the failure as a note and substitute a safe default so the
  // UI still has something to render.
  const dns: DnsSnapshot =
    dnsRes.status === "fulfilled"
      ? dnsRes.value
      : (notes.push(`DNS lookup failed: ${(dnsRes.reason as Error)?.message ?? dnsRes.reason}`),
        {
          spf: { ok: false, value: null, note: "lookup failed" },
          dkim: { ok: false, value: null, selector: "", note: "lookup failed" },
          dmarc: { ok: false, value: null, policy: null, note: "lookup failed" },
          mx: { ok: false, value: null, note: "lookup failed" },
        });

  const blocklists: BlocklistResult[] =
    blRes.status === "fulfilled"
      ? blRes.value
      : (notes.push(
          `Blocklist lookups failed: ${(blRes.reason as Error)?.message ?? blRes.reason}`,
        ),
        []);

  const send_metrics: SendMetrics =
    metricsRes.status === "fulfilled"
      ? metricsRes.value
      : (notes.push(
          `Send metrics query failed: ${(metricsRes.reason as Error)?.message ?? metricsRes.reason}`,
        ),
        {
          window_hours: 24,
          sent: 0,
          bounces: 0,
          unsubscribes: 0,
          replies: 0,
          bounce_rate: 0,
          unsubscribe_rate: 0,
          queue_failures: 0,
          rolling_7d_avg_daily_volume: 0,
          volume_vs_7d_avg: 0,
        });

  const { status, alerts } = evaluate(domain, dns, blocklists, send_metrics);

  const record: DomainHealthCheck = {
    domain,
    checked_at: new Date().toISOString(),
    dns_records: dns,
    blocklists,
    send_metrics,
    status,
    alerts,
    run_notes: notes.length ? notes.join("\n") : null,
  };

  const { error } = await supabase
    .from(opts.tableName ?? "dashboard_domain_health_checks")
    .insert({
      domain: record.domain,
      checked_at: record.checked_at,
      dns_records: record.dns_records,
      blocklists: record.blocklists,
      send_metrics: record.send_metrics,
      status: record.status,
      alerts: record.alerts,
      run_notes: record.run_notes,
    });
  if (error) throw error;

  return record;
}

// Look up the previous check so the notifier can detect regressions
// (transitions from ok → warning / critical).
export async function getPreviousCheck(
  supabase: SupabaseClient,
  domain: string,
  beforeCheckedAt: string,
  tableName = "dashboard_domain_health_checks",
): Promise<DomainHealthCheck | null> {
  const { data, error } = await supabase
    .from(tableName)
    .select(
      "domain, checked_at, dns_records, blocklists, send_metrics, status, alerts, run_notes",
    )
    .eq("domain", domain)
    .lt("checked_at", beforeCheckedAt)
    .order("checked_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data?.[0] as DomainHealthCheck | undefined) ?? null);
}
