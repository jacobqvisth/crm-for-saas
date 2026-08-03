// Resolves the Slack incoming webhook that operational alerts post to.
//
// Background: both /api/cron/check-sync-health and the domain-health cron read
// SLACK_ALERT_WEBHOOK_URL directly, and each silently falls back to
// console.error when it's unset. That variable has never been set in Vercel
// production — only SLACK_BUG_REPORTS_WEBHOOK_URL and
// SLACK_FORUM_POSTS_WEBHOOK_URL are — so every operational alert this app has
// ever raised went to a log line nobody reads.
//
// That is how the core_app sync failed 24x/day from 2026-07-12 for 22 days
// without anyone noticing: the detector fired correctly every morning and
// wrote to stdout.
//
// Resolution order is deliberate:
//   1. SLACK_ALERT_WEBHOOK_URL      — the dedicated alert channel. Set this and
//                                     it wins, no code change needed.
//   2. SLACK_BUG_REPORTS_WEBHOOK_URL — an already-configured internal channel.
//                                     Not the ideal destination, but a real
//                                     human reads it, which beats stdout.
//
// Deliberately does NOT fall back to SLACK_FORUM_POSTS_WEBHOOK_URL: that channel
// carries outbound content for review, and mixing infrastructure alarms into it
// would train people to skim past both.

export type AlertWebhook = {
  url: string;
  /** Which env var supplied the URL — surfaced so callers can report it. */
  source: "SLACK_ALERT_WEBHOOK_URL" | "SLACK_BUG_REPORTS_WEBHOOK_URL";
  /** True when resolved from a fallback rather than the dedicated variable. */
  isFallback: boolean;
};

const RESOLUTION_ORDER = [
  "SLACK_ALERT_WEBHOOK_URL",
  "SLACK_BUG_REPORTS_WEBHOOK_URL",
] as const;

/**
 * Just the shape we read. `process.env` satisfies this, and tests can pass a
 * plain object without having to satisfy all of NodeJS.ProcessEnv.
 */
export type AlertEnv = Record<string, string | undefined>;

export function resolveAlertWebhook(
  env: AlertEnv = process.env,
): AlertWebhook | null {
  for (const source of RESOLUTION_ORDER) {
    const url = env[source];
    // Treat whitespace-only as unset: an env var present but blank is a
    // misconfiguration, not an instruction to post to "".
    if (typeof url === "string" && url.trim().length > 0) {
      return {
        url: url.trim(),
        source,
        isFallback: source !== "SLACK_ALERT_WEBHOOK_URL",
      };
    }
  }

  return null;
}

/**
 * Posts `text` to the resolved alert webhook.
 *
 * Always echoes to console.error as well. The echo is not a fallback, it is a
 * record: when an alert matters enough to page a channel it also belongs in the
 * function logs, and a delivered-to-Slack alert that left no local trace is
 * harder to reconstruct after the fact.
 */
export async function postAlert(
  logPrefix: string,
  text: string,
  env: AlertEnv = process.env,
): Promise<{ channel: "slack" | "console"; sent: boolean; webhookSource: string | null }> {
  const webhook = resolveAlertWebhook(env);

  console.error(`[${logPrefix}]\n${text}`);

  if (!webhook) {
    console.error(
      `[${logPrefix}] no alert webhook configured — set SLACK_ALERT_WEBHOOK_URL so this reaches a human`,
    );
    return { channel: "console", sent: true, webhookSource: null };
  }

  if (webhook.isFallback) {
    console.error(
      `[${logPrefix}] posting via ${webhook.source} because SLACK_ALERT_WEBHOOK_URL is unset`,
    );
  }

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      return { channel: "slack", sent: true, webhookSource: webhook.source };
    }

    console.error(`[${logPrefix}] Slack webhook failed status=${res.status}`);
  } catch (err) {
    console.error(`[${logPrefix}] Slack webhook threw`, err);
  }

  // The message is already in the logs from the echo above.
  return { channel: "console", sent: true, webhookSource: webhook.source };
}
