import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/api";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshSlackContributorSummary } from "@/lib/forums/contributors";
import type { ForumSource } from "@/lib/forums/types";

// Slack Events API endpoint — the inbound half of the forums ✅ roundtrip.
//
// When a teammate reacts :white_check_mark: on their own comment in the
// #forum-posts thread, Slack POSTs a `reaction_added` event here. We match the
// reacted message's ts to the forum_comment_assignments row it belongs to (its
// slack_message_ts) and mark that member as having posted on Reddit. Removing
// the reaction reverts a reaction-driven confirmation.
//
// Setup (one-time, by Jacob — see the forums Slack setup doc):
//   - Create/confirm the Slack app, add a bot token (chat:write, reactions:read)
//     and the signing secret to Vercel env.
//   - Enable Event Subscriptions, set the Request URL to
//     https://crm-for-saas.vercel.app/api/slack/events, subscribe to
//     reaction_added + reaction_removed (bot events), invite the bot to
//     #forum-posts.
//
// No user session exists on a webhook, so we authenticate via the signing
// secret and use the service-role client (bypasses RLS).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reactions we treat as "I posted this" — any of the common check marks.
const DONE_REACTIONS = new Set([
  "white_check_mark",
  "heavy_check_mark",
  "ballot_box_with_check",
  "white_tick",
]);

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  event?: {
    type?: string;
    reaction?: string;
    user?: string;
    item?: { type?: string; channel?: string; ts?: string };
  };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const valid = verifySlackSignature({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });
  if (!valid) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: SlackEnvelope;
  try {
    body = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // URL verification handshake performed when you set the Request URL.
  if (body.type === "url_verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type === "event_callback" && body.event) {
    const ev = body.event;
    const isReaction = ev.type === "reaction_added" || ev.type === "reaction_removed";
    if (
      isReaction &&
      ev.reaction &&
      DONE_REACTIONS.has(ev.reaction) &&
      ev.item?.type === "message" &&
      ev.item.ts
    ) {
      // Fire-and-forget so we always ack Slack fast (it retries on non-200).
      await handleReaction(ev.type === "reaction_added", ev.item.ts, ev.item.channel ?? null);
    }
  }

  // Always 200 so Slack doesn't retry unmatched events.
  return NextResponse.json({ ok: true });
}

async function handleReaction(added: boolean, messageTs: string, channel: string | null) {
  try {
    const supabase = createServiceClient();
    const { data: rows } = await supabase
      .from("forum_comment_assignments")
      .select("id, confirmed_via, slack_channel_id, source, source_id")
      .eq("slack_message_ts", messageTs);

    if (!rows || rows.length === 0) return;
    // If we recorded a channel, prefer the exact match; else take the row.
    const row =
      rows.find((r) => !channel || !r.slack_channel_id || r.slack_channel_id === channel) ??
      rows[0];
    if (!row) return;

    if (added) {
      await supabase
        .from("forum_comment_assignments")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
          confirmed_via: "slack_reaction",
        })
        .eq("id", row.id);
    } else {
      // Only undo confirmations that came from a reaction — never a CRM mark or
      // an authoritative Reddit detection.
      if (row.confirmed_via === "slack_reaction") {
        await supabase
          .from("forum_comment_assignments")
          .update({ status: "suggested", posted_at: null, confirmed_via: null })
          .eq("id", row.id);
      }
    }

    // Keep the thread's "contributors so far" summary current.
    await refreshSlackContributorSummary({
      supabase,
      source: row.source as ForumSource,
      sourceId: row.source_id,
    });
  } catch {
    // Best-effort — never surface to Slack (would trigger retries).
  }
}
