import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { scanRedditMentions } from "@/lib/forums/mention-scan";
import { isSlackBotConfigured, forumChannelId, postSlackMessage } from "@/lib/slack/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold Apify scrape can run ~200s; give the whole scan the max window.
export const maxDuration = 300;

// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/* — the
// scan spends Apify credits, so it must not be publicly triggerable.
function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || request.headers.get("x-sync-secret");
  if (!syncSecret && !cronSecret) return process.env.NODE_ENV !== "production";
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

// GET /api/forums/mentions/scan
//
// Vercel Cron hits this (crons are GET, and Vercel sends the CRON_SECRET
// bearer). Scans Reddit for the Wrenchlane footprint we didn't create, upserts
// reddit_mentions, and Slack-alerts new third-party hits.
//
// Uses the service-role client so the cron isn't tied to a user session; all
// forum tables share one workspace (SHARED_FORUMS_WORKSPACE_ID).
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient() as unknown as SupabaseClient;

  const result = await scanRedditMentions({
    supabase,
    workspaceId: SHARED_FORUMS_WORKSPACE_ID,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 503 });
  }

  // Alert the team about genuinely new third-party mentions so they can jump in
  // from their own accounts. Best-effort — never fails the scan.
  let alerted = 0;
  if (result.newThirdParty.length > 0 && isSlackBotConfigured()) {
    const channel = forumChannelId()!;
    for (const m of result.newThirdParty) {
      const sub = m.subreddit ? `r/${m.subreddit.replace(/^r\//i, "")}` : "Reddit";
      const who = m.author ? `u/${m.author}` : "someone";
      const kind = m.kind === "link" ? "linked to Wrenchlane" : "mentioned Wrenchlane";
      const mood = m.sentiment ? ` _(${m.sentiment})_` : "";
      const text =
        `:eyes: *New Wrenchlane mention on Reddit*${mood} — ${who} ${kind} in ${sub}\n` +
        (m.summary ? `${m.summary}\n` : m.excerpt ? `> ${m.excerpt}\n` : "") +
        `<${m.source_url}|Open the thread> — worth a genuine reply from someone whose account fits.`;
      const posted = await postSlackMessage({ channel, text });
      if (posted.ok) {
        alerted++;
        await supabase
          .from("reddit_mentions")
          .update({ slack_notified_at: new Date().toISOString() })
          .eq("id", m.id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    postsScanned: result.postsScanned,
    threadsSwept: result.threadsSwept,
    found: result.found,
    newThirdParty: result.newThirdParty.length,
    alerted,
  });
}
