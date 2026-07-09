import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { generateForumComments, type PerMemberComment } from "./comment";
import { postForumPostMembers, FORUM_TEAM } from "@/lib/slack/notify";
import { isSlackBotConfigured, forumChannelId, postSlackMessage } from "@/lib/slack/api";

// Fan-out when a forum item is marked posted (Distribution rec or generated
// post). Two things happen, both best-effort — the caller must NEVER fail the
// mark-posted action if this throws:
//
//   1. Per-member comments: draft one distinct Reddit reply for each active
//      roster member and persist them as forum_comment_assignments rows, so the
//      CRM can show "here's yours, Matteo" and track who posted.
//   2. Slack: post a parent "post is live" message to #forum-posts, then one
//      threaded reply per member carrying their own comment. Each reply's ts is
//      stored on its assignment so a ✅ reaction maps back to the member.
//      Without a bot token we fall back to a single inline webhook message.
//
// Returns the parent thread identifiers to persist on the forum row + whether
// Slack was reached; assignment rows are written here directly.

type DB = SupabaseClient<Database>;

export type ForumSource = "distribution" | "post";

export type NotifyForumPostedInput = {
  supabase: DB;
  workspaceId: string;
  source: ForumSource;
  sourceId: string;
  subreddit: string;
  tone?: string | null;
  rulesNote?: string | null;
  title: string;
  body?: string | null;
  url: string;
  /** Resend: redraft every member's comment and re-post the Slack thread. */
  forceRegenerate?: boolean;
};

export type NotifyForumPostedResult = {
  slackConfigured: boolean;
  notifiedAt: string | null;
  threadTs: string | null;
  channelId: string | null;
  memberCount: number;
  reason?: string;
};

type RosterMember = {
  account_id: string | null;
  owner_label: string;
  slack_user_id: string | null;
};

export async function notifyForumPosted(
  input: NotifyForumPostedInput,
): Promise<NotifyForumPostedResult> {
  const { supabase, workspaceId, source, sourceId } = input;
  const empty: NotifyForumPostedResult = {
    slackConfigured: false,
    notifiedAt: null,
    threadTs: null,
    channelId: null,
    memberCount: 0,
  };

  // 1. Who gets a comment — active roster accounts, else the plain team list.
  const roster = await loadRoster(supabase, workspaceId);
  if (roster.length === 0) return { ...empty, reason: "no team members" };

  // 2. Existing assignments for this item (by member).
  const { data: existingRows } = await supabase
    .from("forum_comment_assignments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", sourceId);
  const existing = new Map(
    (existingRows ?? []).map((r) => [r.owner_label, r]),
  );

  // 3. Draft comments for members who don't have one yet (or everyone on resend).
  const needComments = input.forceRegenerate
    ? roster
    : roster.filter((m) => !existing.get(m.owner_label)?.comment);
  const drafted = new Map<string, string>();
  if (needComments.length > 0) {
    const gen = await generateForumComments({
      subreddit: input.subreddit,
      tone: input.tone,
      rulesNote: input.rulesNote,
      title: input.title,
      body: input.body,
      members: needComments.map((m) => m.owner_label),
    });
    if (gen.ok) {
      for (const c of gen.comments) drafted.set(c.owner_label, c.comment);
    }
  }

  // 4. Upsert an assignment row per member (comment + who it's for). Preserve any
  //    existing posting state; only refresh the comment text.
  const commentFor = (m: RosterMember): string | null =>
    drafted.get(m.owner_label) ?? existing.get(m.owner_label)?.comment ?? null;

  const upserts = roster.map((m) => ({
    workspace_id: workspaceId,
    source,
    source_id: sourceId,
    account_id: m.account_id,
    owner_label: m.owner_label,
    comment: commentFor(m),
  }));
  await supabase
    .from("forum_comment_assignments")
    .upsert(upserts, { onConflict: "workspace_id,source,source_id,owner_label" });

  const members: PerMemberComment[] = roster.map((m) => ({
    owner_label: m.owner_label,
    comment: commentFor(m) ?? "",
  }));

  // 5. Slack. Prefer the bot (threaded + ✅ roundtrip); else webhook fallback.
  if (isSlackBotConfigured()) {
    return await postThreaded(input, roster, commentFor);
  }

  const slack = await postForumPostMembers({
    subreddit: input.subreddit,
    title: input.title,
    url: input.url,
    members: members.map((m) => ({ owner_label: m.owner_label, comment: m.comment || null })),
  });
  return {
    slackConfigured: slack.configured,
    notifiedAt: slack.ok ? new Date().toISOString() : null,
    threadTs: null,
    channelId: null,
    memberCount: roster.length,
    reason: slack.reason,
  };
}

// Post the parent message + one threaded reply per member, storing each reply's
// ts on its assignment so reactions map home.
async function postThreaded(
  input: NotifyForumPostedInput,
  roster: RosterMember[],
  commentFor: (m: RosterMember) => string | null,
): Promise<NotifyForumPostedResult> {
  const { supabase, workspaceId, source, sourceId } = input;
  const channel = forumChannelId()!;

  const parent = await postSlackMessage({
    channel,
    text: [
      ":mega: *New forum post is live — jump in and comment from your own Reddit account*",
      `<${input.url}|${input.title}>  ·  ${input.subreddit}`,
      "",
      "Each reply below is drafted for one of you. Post yours on Reddit, then react :white_check_mark: on your own message here and the CRM will mark it done.",
    ].join("\n"),
  });
  if (!parent.ok) {
    return {
      slackConfigured: true,
      notifiedAt: null,
      threadTs: null,
      channelId: null,
      memberCount: roster.length,
      reason: parent.reason,
    };
  }

  for (const m of roster) {
    const comment = commentFor(m);
    if (!comment) continue;
    const mention = m.slack_user_id ? `<@${m.slack_user_id}>` : `*${m.owner_label}*`;
    const text = [`${mention} — your comment:`, ...comment.split("\n").map((l) => `> ${l}`)].join(
      "\n",
    );
    const reply = await postSlackMessage({ channel, text, thread_ts: parent.ts });
    if (reply.ok) {
      await supabase
        .from("forum_comment_assignments")
        .update({ slack_message_ts: reply.ts, slack_channel_id: reply.channel })
        .eq("workspace_id", workspaceId)
        .eq("source", source)
        .eq("source_id", sourceId)
        .eq("owner_label", m.owner_label);
    }
  }

  return {
    slackConfigured: true,
    notifiedAt: new Date().toISOString(),
    threadTs: parent.ts,
    channelId: parent.channel,
    memberCount: roster.length,
  };
}

async function loadRoster(supabase: DB, workspaceId: string): Promise<RosterMember[]> {
  const { data } = await supabase
    .from("reddit_accounts")
    .select("id, owner_label, slack_user_id, active")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("owner_label", { ascending: true });

  if (data && data.length > 0) {
    // De-dupe by owner_label (a member may control several accounts) — one
    // comment per person, tied to their first active account.
    const seen = new Set<string>();
    const out: RosterMember[] = [];
    for (const r of data) {
      if (seen.has(r.owner_label)) continue;
      seen.add(r.owner_label);
      out.push({
        account_id: r.id,
        owner_label: r.owner_label,
        slack_user_id: r.slack_user_id,
      });
    }
    return out;
  }

  // Roster never seeded (nobody opened the accounts panel) — fall back to the
  // known team names so the feature still works.
  return FORUM_TEAM.map((owner_label) => ({
    account_id: null,
    owner_label,
    slack_user_id: null,
  }));
}
