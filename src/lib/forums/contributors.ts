import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ForumSource } from "./types";
import { fetchRedditCommenters } from "./reddit";
import {
  isSlackBotConfigured,
  postSlackMessage,
  updateSlackMessage,
} from "@/lib/slack/api";

// Contribution tracking: who on the team actually engaged with a posted forum
// item. Only two signals count as "contributed" (Jacob's call):
//   - reddit_detected: their roster Reddit handle showed up as a commenter on
//     the real thread (authoritative).
//   - slack_reaction:  they ✅'d their own comment in the #forum-posts thread.
// (A manual CRM "X posted this" mark stays possible but is NOT counted here.)

type DB = SupabaseClient<Database>;

export const CONTRIBUTED_VIA = ["reddit_detected", "slack_reaction"] as const;

// ---- Reddit comment-author detection ---------------------------------------

export type ScanResult = {
  ok: boolean;
  reason?: string;
  commentersFound: number;
  matched: string[]; // owner_labels newly/again confirmed via Reddit
};

// Read the thread's commenters and mark any that match a roster Reddit handle
// as having contributed (confirmed_via='reddit_detected'). Best-effort.
export async function scanRedditContributors(opts: {
  supabase: DB;
  workspaceId: string;
  source: ForumSource;
  sourceId: string;
  url: string;
}): Promise<ScanResult> {
  const { supabase, workspaceId, source, sourceId, url } = opts;

  const res = await fetchRedditCommenters(url);
  if (!res.ok) return { ok: false, reason: res.reason, commentersFound: 0, matched: [] };

  // Roster handle (lowercased) → member.
  const { data: accounts } = await supabase
    .from("reddit_accounts")
    .select("id, owner_label, username")
    .eq("workspace_id", workspaceId);
  const handleToMember = new Map<string, { owner_label: string; account_id: string }>();
  for (const a of accounts ?? []) {
    if (a.username) {
      handleToMember.set(a.username.replace(/^\/?u\//i, "").toLowerCase(), {
        owner_label: a.owner_label,
        account_id: a.id,
      });
    }
  }

  // First matching comment per member (keep the permalink + exact author).
  const hits = new Map<string, { author: string; permalink: string | null; account_id: string }>();
  for (const c of res.commenters) {
    const m = handleToMember.get(c.author.toLowerCase());
    if (m && !hits.has(m.owner_label)) {
      hits.set(m.owner_label, { author: c.author, permalink: c.permalink, account_id: m.account_id });
    }
  }

  const nowIso = new Date().toISOString();
  for (const [owner_label, hit] of hits) {
    // Read any existing row to preserve posted_at.
    const { data: existing } = await supabase
      .from("forum_comment_assignments")
      .select("id, posted_at")
      .eq("workspace_id", workspaceId)
      .eq("source", source)
      .eq("source_id", sourceId)
      .eq("owner_label", owner_label)
      .maybeSingle();

    const patch = {
      workspace_id: workspaceId,
      source,
      source_id: sourceId,
      account_id: hit.account_id,
      owner_label,
      status: "posted" as const,
      confirmed_via: "reddit_detected" as const,
      posted_at: existing?.posted_at ?? nowIso,
      reddit_comment_url: hit.permalink,
      detected_author: hit.author,
    };
    await supabase
      .from("forum_comment_assignments")
      .upsert(patch, { onConflict: "workspace_id,source,source_id,owner_label" });
  }

  return { ok: true, commentersFound: res.commenters.length, matched: [...hits.keys()] };
}

// ---- Aggregate leaderboard --------------------------------------------------

export type ContributorTotal = {
  owner_label: string;
  total: number;
  reddit: number;
  slack: number;
};

// Per-member contribution totals across every posted forum item in the
// workspace, most active first.
export async function getContributorLeaderboard(
  supabase: DB,
  workspaceId: string,
): Promise<ContributorTotal[]> {
  const { data } = await supabase
    .from("forum_comment_assignments")
    .select("owner_label, confirmed_via")
    .eq("workspace_id", workspaceId)
    .in("confirmed_via", CONTRIBUTED_VIA as unknown as string[]);

  const byMember = new Map<string, ContributorTotal>();
  for (const row of data ?? []) {
    const t =
      byMember.get(row.owner_label) ??
      { owner_label: row.owner_label, total: 0, reddit: 0, slack: 0 };
    t.total += 1;
    if (row.confirmed_via === "reddit_detected") t.reddit += 1;
    else if (row.confirmed_via === "slack_reaction") t.slack += 1;
    byMember.set(row.owner_label, t);
  }
  return [...byMember.values()].sort((a, b) => b.total - a.total || a.owner_label.localeCompare(b.owner_label));
}

// ---- Slack "contributors so far" summary ------------------------------------

function summaryText(
  title: string,
  url: string,
  assignments: { owner_label: string; confirmed_via: string | null }[],
): string {
  const reddit = assignments.filter((a) => a.confirmed_via === "reddit_detected").map((a) => a.owner_label);
  const slack = assignments.filter((a) => a.confirmed_via === "slack_reaction").map((a) => a.owner_label);
  const contributed = new Set([...reddit, ...slack]);
  const lines = [`:busts_in_silhouette: *Contributors so far* — <${url}|${title}>`];
  lines.push(
    reddit.length ? `:white_check_mark: Commented on Reddit: ${reddit.join(", ")}` : ":white_check_mark: Commented on Reddit: —",
  );
  if (slack.length) lines.push(`:speech_balloon: Confirmed via Slack ✅: ${slack.join(", ")}`);
  lines.push(`_${contributed.size}/${assignments.length} of the team so far_`);
  return lines.join("\n");
}

// Post (or edit) the contributors summary in the item's Slack thread. No-op
// unless the bot is configured and we have a parent thread to hang it under.
export async function refreshSlackContributorSummary(opts: {
  supabase: DB;
  source: ForumSource;
  sourceId: string;
}): Promise<void> {
  const { supabase, source, sourceId } = opts;
  if (!isSlackBotConfigured()) return;

  const table = source === "distribution" ? "forum_distribution" : "forum_posts";
  const titleCol = source === "distribution" ? "suggested_title" : "generated_title";
  const { data: row } = await supabase
    .from(table)
    .select(
      `id, posted_url, slack_thread_ts, slack_channel_id, slack_summary_ts, slack_summary_channel, ${titleCol}`,
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (!row) return;

  const r = row as unknown as {
    posted_url: string | null;
    slack_thread_ts: string | null;
    slack_channel_id: string | null;
    slack_summary_ts: string | null;
    slack_summary_channel: string | null;
    suggested_title?: string | null;
    generated_title?: string | null;
  };
  const threadTs = r.slack_thread_ts;
  const channel = r.slack_summary_channel ?? r.slack_channel_id;
  if (!threadTs || !channel) return; // never fanned out via the bot

  const { data: assignments } = await supabase
    .from("forum_comment_assignments")
    .select("owner_label, confirmed_via")
    .eq("source", source)
    .eq("source_id", sourceId)
    .order("owner_label", { ascending: true });

  const title = r.suggested_title ?? r.generated_title ?? "forum post";
  const text = summaryText(title, r.posted_url ?? "", assignments ?? []);

  if (r.slack_summary_ts) {
    await updateSlackMessage({ channel, ts: r.slack_summary_ts, text });
    return;
  }
  const posted = await postSlackMessage({ channel, text, thread_ts: threadTs });
  if (posted.ok) {
    await supabase
      .from(table)
      .update({ slack_summary_ts: posted.ts, slack_summary_channel: posted.channel })
      .eq("id", sourceId);
  }
}
