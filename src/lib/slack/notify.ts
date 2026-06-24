// Slack notification for sending call follow-ups / bugs to a channel.
// Mirrors the SLACK_ALERT_WEBHOOK_URL pattern used by domain-health, but uses a
// dedicated SLACK_BUG_REPORTS_WEBHOOK_URL incoming webhook bound to the
// #bug-reports channel so these don't mix with infra alerts.

export type SlackBugReport = {
  title: string;
  detail?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  /** Absolute link back to the contact/call in the CRM. */
  contactUrl?: string | null;
  /** Suggested due date (ISO yyyy-mm-dd). */
  dueDate?: string | null;
  /** Who sent it (agent email). */
  reportedBy?: string | null;
};

export type SlackResult = { ok: boolean; reason?: string; configured: boolean };

export async function postBugReport(r: SlackBugReport): Promise<SlackResult> {
  const webhook = process.env.SLACK_BUG_REPORTS_WEBHOOK_URL;
  if (!webhook) return { ok: false, configured: false, reason: "SLACK_BUG_REPORTS_WEBHOOK_URL not set" };

  const lines: string[] = [`:beetle: *${r.title}*`];
  if (r.detail) lines.push(r.detail);
  const ctx = [r.contactName, r.companyName].filter(Boolean).join(" · ");
  if (ctx) lines.push(`:bust_in_silhouette: ${ctx}`);
  if (r.dueDate) lines.push(`:calendar: ${r.dueDate}`);
  if (r.contactUrl) lines.push(`<${r.contactUrl}|Open in CRM>`);
  if (r.reportedBy) lines.push(`_sent from the CRM by ${r.reportedBy}_`);

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
    if (res.ok) return { ok: true, configured: true };
    return { ok: false, configured: true, reason: `Slack webhook status ${res.status}` };
  } catch (err) {
    return { ok: false, configured: true, reason: err instanceof Error ? err.message : "Slack post failed" };
  }
}
