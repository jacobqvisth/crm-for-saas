// Slack notification for domain-health regressions. Delivery (and the
// SLACK_ALERT_WEBHOOK_URL → SLACK_BUG_REPORTS_WEBHOOK_URL resolution order) is
// shared with /api/cron/check-sync-health via lib/alerting/webhook.ts.
//
// Notification policy (kept simple on purpose):
//   * critical now           → always notify
//   * warning now, ok before → notify (regression)
//   * warning now, warning before → notify ONLY if the alert list changed
//     (otherwise we'd Slack-spam every morning during a slow recovery)
//   * ok                     → never notify

import { postAlert } from "@/lib/alerting/webhook";
import type { DomainHealthCheck } from "./index";

export type NotifyOutcome = {
  channel: "slack" | "console" | "none";
  sent: boolean;
  reason: string;
};

export async function notifyDomainHealth(
  current: DomainHealthCheck,
  previous: DomainHealthCheck | null,
): Promise<NotifyOutcome> {
  const shouldNotify = decideNotify(current, previous);
  if (!shouldNotify.notify) {
    return { channel: "none", sent: false, reason: shouldNotify.reason };
  }

  const text = formatSlackMessage(current, previous);

  const outcome = await postAlert("domain-health", text);
  return {
    channel: outcome.channel,
    sent: outcome.sent,
    reason: shouldNotify.reason,
  };
}

function decideNotify(
  current: DomainHealthCheck,
  previous: DomainHealthCheck | null,
): { notify: boolean; reason: string } {
  if (current.status === "ok") return { notify: false, reason: "status ok" };
  if (current.status === "critical") return { notify: true, reason: "critical" };

  // status === "warning"
  if (!previous) return { notify: true, reason: "first run, warning" };
  if (previous.status === "ok") return { notify: true, reason: "regression ok→warning" };
  if (previous.status === "critical") {
    return { notify: true, reason: "improvement critical→warning (still notify)" };
  }
  // warning → warning: only re-alert if the alert lines changed.
  const prevSet = new Set(previous.alerts);
  const changed =
    current.alerts.some((a) => !prevSet.has(a)) ||
    previous.alerts.some((a) => !current.alerts.includes(a));
  return {
    notify: changed,
    reason: changed ? "alert set changed" : "same warning as previous run",
  };
}

function formatSlackMessage(
  current: DomainHealthCheck,
  previous: DomainHealthCheck | null,
): string {
  const emoji = current.status === "critical" ? "🚨" : "⚠️";
  const transition = previous
    ? ` (was ${previous.status} at ${previous.checked_at})`
    : "";
  const lines: string[] = [
    `${emoji} *Domain health — ${current.domain}* — status: *${current.status}*${transition}`,
  ];
  for (const a of current.alerts) lines.push(`• ${a}`);
  lines.push(
    `Sent (24h): ${current.send_metrics.sent} · Bounces: ${current.send_metrics.bounces} · Unsubs: ${current.send_metrics.unsubscribes} · Queue failures: ${current.send_metrics.queue_failures}`,
  );
  return lines.join("\n");
}
