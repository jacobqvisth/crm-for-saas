// Slack notification for sending call follow-ups / bugs to a channel.
// Mirrors the SLACK_ALERT_WEBHOOK_URL pattern used by domain-health, but uses a
// dedicated SLACK_BUG_REPORTS_WEBHOOK_URL incoming webhook bound to the
// #bug-reports channel so these don't mix with infra alerts.
// Webhook configured in Vercel env (codeoc workspace, #bug-reports) 2026-06-26.

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

// The people who should go comment on each forum post from their own Reddit
// account. Shown at the bottom of the Slack message so everyone's pinged.
export const FORUM_TEAM = ["Hans", "Hasse", "Magnus", "Dogu", "Matteo", "Jacob"];

export type SlackForumPost = {
  /** e.g. "r/AutoRepair" */
  subreddit: string;
  /** The post title, for the Slack link text. */
  title: string;
  /** Where it's live on Reddit. */
  url: string;
  /** AI-drafted reply the team can paste as a comment. */
  comment?: string | null;
};

// Posts a "new forum post is live" message to #forum-posts so the team can open
// it and comment from their own Reddit accounts. Uses a dedicated incoming
// webhook (SLACK_FORUM_POSTS_WEBHOOK_URL) bound to #forum-posts, mirroring the
// bug-reports webhook pattern. Set SLACK_FORUM_TEAM_MENTIONS to a space-joined
// list of <@USERID> to turn the name list into real @-mentions.
export async function postForumPost(p: SlackForumPost): Promise<SlackResult> {
  const webhook = process.env.SLACK_FORUM_POSTS_WEBHOOK_URL;
  if (!webhook)
    return { ok: false, configured: false, reason: "SLACK_FORUM_POSTS_WEBHOOK_URL not set" };

  const lines: string[] = [
    ":mega: *New forum post is live — jump in and comment from your own Reddit account*",
    `<${p.url}|${p.title}>  ·  ${p.subreddit}`,
  ];
  if (p.comment) {
    lines.push("");
    lines.push("*Suggested comment* (reword it in your own voice so they're not identical):");
    for (const line of p.comment.split("\n")) lines.push(`> ${line}`);
  }
  lines.push("");
  const mentions = process.env.SLACK_FORUM_TEAM_MENTIONS?.trim();
  lines.push(mentions && mentions.length ? mentions : FORUM_TEAM.join(", "));

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
    if (res.ok) return { ok: true, configured: true };
    return { ok: false, configured: true, reason: `Slack webhook status ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: err instanceof Error ? err.message : "Slack post failed",
    };
  }
}

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
