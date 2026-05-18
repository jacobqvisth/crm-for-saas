// Trailing-24h send-health metrics from email_queue + email_events.
//
// These are the numbers Gmail itself uses to decide whether wrenchlane.com
// gets to keep sending at full speed. The thresholds we alert on are:
//
//   bounce_rate      >3% warning, >5% critical (Gmail throttles ≥5%)
//   unsubscribe_rate >2% warning   (industry-safe is <0.5%)
//   queue_failures   >0 (any) — Gmail rejected the message at the API layer
//   volume_vs_7d_avg >3× — possible runaway sequence; back off and review
//
// All percentages are decimals (0.014 = 1.4%) to keep math sane downstream.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SendMetrics = {
  window_hours: number;
  sent: number;
  bounces: number;
  unsubscribes: number;
  replies: number;
  bounce_rate: number;
  unsubscribe_rate: number;
  queue_failures: number;
  // Trailing 7-day average daily volume (excludes the current 24h window
  // so it's a stable comparator).
  rolling_7d_avg_daily_volume: number;
  // Ratio of (sent in last 24h) / (rolling 7d avg). >3 = spike.
  volume_vs_7d_avg: number;
};

export async function getSendMetrics(
  supabase: SupabaseClient,
): Promise<SendMetrics> {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const since24h = new Date(now - day).toISOString();
  const since8d = new Date(now - 8 * day).toISOString();

  // We pull both the queue counts and event counts for the same 24h
  // window. Bounces and unsubscribes are written to email_events with
  // event_type='bounce' / 'unsubscribe' by the Gmail reply checker.
  const [queueRecent, queueOlder7d, queueFailedRecent, events] = await Promise.all([
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", since24h),
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .lt("sent_at", since24h)
      .gte("sent_at", since8d),
    supabase
      .from("email_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", since24h),
    supabase
      .from("email_events")
      .select("event_type")
      .gte("created_at", since24h),
  ]);

  for (const r of [queueRecent, queueOlder7d, queueFailedRecent, events]) {
    if (r.error) throw r.error;
  }

  const sent = queueRecent.count ?? 0;
  const queue_failures = queueFailedRecent.count ?? 0;
  const older7dTotal = queueOlder7d.count ?? 0;
  const rolling_7d_avg_daily_volume = older7dTotal / 7;

  const evRows = (events.data ?? []) as Array<{ event_type: string }>;
  let bounces = 0;
  let unsubscribes = 0;
  let replies = 0;
  for (const ev of evRows) {
    if (ev.event_type === "bounce") bounces++;
    else if (ev.event_type === "unsubscribe") unsubscribes++;
    else if (ev.event_type === "reply") replies++;
  }

  const denominator = Math.max(sent, 1); // never divide by zero
  const bounce_rate = bounces / denominator;
  const unsubscribe_rate = unsubscribes / denominator;
  const volume_vs_7d_avg =
    rolling_7d_avg_daily_volume > 0 ? sent / rolling_7d_avg_daily_volume : 0;

  return {
    window_hours: 24,
    sent,
    bounces,
    unsubscribes,
    replies,
    bounce_rate,
    unsubscribe_rate,
    queue_failures,
    rolling_7d_avg_daily_volume,
    volume_vs_7d_avg,
  };
}
