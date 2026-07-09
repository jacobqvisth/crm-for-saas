// Slack Web API helper — the two-way half of the forums integration.
//
// The one-way incoming webhook (see notify.ts) can only fire text into a
// channel; it can't tell us the message's timestamp, so there's nothing to hang
// a reaction off. To thread per-member comments AND close the ✅ loop we use a
// bot token instead:
//   - chat.postMessage returns the message `ts`, which we store per assignment.
//   - the Events API delivers reaction_added with that same `ts`, so a ✅ maps
//     straight back to the member's comment row.
//
// Env (set once by Jacob — see the forums Slack setup doc):
//   SLACK_BOT_TOKEN            xoxb-… bot token with chat:write + reactions:read
//   SLACK_FORUM_POSTS_CHANNEL_ID  channel id of #forum-posts (e.g. C0123ABCD)
//   SLACK_SIGNING_SECRET       app signing secret, to verify inbound events
//
// Everything degrades gracefully: with no bot token the caller falls back to the
// legacy single-message webhook.

import crypto from "crypto";

export function isSlackBotConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && forumChannelId());
}

export function forumChannelId(): string | null {
  return process.env.SLACK_FORUM_POSTS_CHANNEL_ID?.trim() || null;
}

export type PostMessageResult =
  | { ok: true; ts: string; channel: string }
  | { ok: false; reason: string };

// Posts a message via chat.postMessage. Pass `thread_ts` to reply in a thread.
// `mrkdwn` Slack markdown is on by default.
export async function postSlackMessage(opts: {
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<PostMessageResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: "SLACK_BOT_TOKEN not set" };

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: opts.channel,
        text: opts.text,
        thread_ts: opts.thread_ts,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      ts?: string;
      channel?: string;
      error?: string;
    };
    if (data.ok && data.ts) {
      return { ok: true, ts: data.ts, channel: data.channel ?? opts.channel };
    }
    return { ok: false, reason: `Slack chat.postMessage error: ${data.error ?? "unknown"}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Slack post failed" };
  }
}

// Edits an existing message (used to keep the "contributors so far" summary
// fresh in the thread). Returns ok:false if the bot token isn't set.
export async function updateSlackMessage(opts: {
  channel: string;
  ts: string;
  text: string;
}): Promise<PostMessageResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: "SLACK_BOT_TOKEN not set" };
  try {
    const res = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: opts.channel, ts: opts.ts, text: opts.text }),
    });
    const data = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (data.ok && data.ts) return { ok: true, ts: data.ts, channel: data.channel ?? opts.channel };
    return { ok: false, reason: `Slack chat.update error: ${data.error ?? "unknown"}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Slack update failed" };
  }
}

// Verifies an inbound Slack request using the v0 signing scheme:
//   base = "v0:{timestamp}:{rawBody}"; sig = "v0=" + HMAC_SHA256(base, secret)
// Rejects requests older than 5 minutes (replay protection). `rawBody` MUST be
// the exact bytes Slack sent — read the body as text before any JSON parsing.
export function verifySlackSignature(opts: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !opts.timestamp || !opts.signature) return false;

  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  // Within 5 minutes of now.
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const base = `v0:${opts.timestamp}:${opts.rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
