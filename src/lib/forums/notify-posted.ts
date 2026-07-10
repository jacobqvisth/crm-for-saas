import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { generateForumComments } from "./comment";
import { postForumPostMembers, FORUM_TEAM } from "@/lib/slack/notify";
import { isSlackBotConfigured, forumChannelId, postSlackMessage } from "@/lib/slack/api";
import type { ForumGenerationOptions } from "./generation-options";
import type { ForumSource } from "./types";

// Two DECOUPLED steps for a posted forum item (Distribution rec or generated
// post). They're deliberately separate so the team can draft + review + redraft
// the per-member comments first, then send to Slack as its own action:
//
//   1. draftForumComments()  — generate one distinct Reddit comment per active
//      roster member and persist them as forum_comment_assignments rows. No
//      Slack. Safe to re-run (redraft).
//   2. sendForumPostToSlack() — post the CURRENT drafts to #forum-posts: a
//      parent message + one threaded reply per member (bot), or a single inline
//      message (webhook fallback). Never regenerates the comments.
//
// Both are best-effort — the caller must never fail the underlying save if
// these throw.

type DB = SupabaseClient<Database>;

type RosterMember = {
  account_id: string | null;
  owner_label: string;
  slack_user_id: string | null;
};

// ---- Step 1: draft --------------------------------------------------------

export type DraftForumCommentsInput = {
  supabase: DB;
  workspaceId: string;
  source: ForumSource;
  sourceId: string;
  subreddit: string;
  tone?: string | null;
  rulesNote?: string | null;
  title: string;
  body?: string | null;
  /** Redraft: regenerate every member's comment, not just the missing ones. */
  regenerate?: boolean;
  /** How the comments should be written (mention level + style axes). */
  options?: Partial<ForumGenerationOptions> | null;
};

// Generate + persist a distinct comment per active roster member. Returns how
// many members now have a draft. No Slack side effects.
export async function draftForumComments(
  input: DraftForumCommentsInput,
): Promise<{ memberCount: number }> {
  const { supabase, workspaceId, source, sourceId } = input;

  const roster = await loadRoster(supabase, workspaceId);
  if (roster.length === 0) return { memberCount: 0 };

  const { data: existingRows } = await supabase
    .from("forum_comment_assignments")
    .select("owner_label, comment")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", sourceId);
  const existing = new Map((existingRows ?? []).map((r) => [r.owner_label, r.comment]));

  const needComments = input.regenerate
    ? roster
    : roster.filter((m) => !existing.get(m.owner_label));
  const drafted = new Map<string, string>();
  if (needComments.length > 0) {
    const gen = await generateForumComments({
      subreddit: input.subreddit,
      tone: input.tone,
      rulesNote: input.rulesNote,
      title: input.title,
      body: input.body,
      members: needComments.map((m) => m.owner_label),
      options: input.options,
    });
    if (gen.ok) for (const c of gen.comments) drafted.set(c.owner_label, c.comment);
  }

  // Upsert one row per member — only the comment text is (re)written here;
  // posting state (status / confirmed_via / slack ts) is preserved on conflict.
  const upserts = roster.map((m) => ({
    workspace_id: workspaceId,
    source,
    source_id: sourceId,
    account_id: m.account_id,
    owner_label: m.owner_label,
    comment: drafted.get(m.owner_label) ?? existing.get(m.owner_label) ?? null,
  }));
  await supabase
    .from("forum_comment_assignments")
    .upsert(upserts, { onConflict: "workspace_id,source,source_id,owner_label" });

  return { memberCount: roster.length };
}

// ---- Step 2: send to Slack ------------------------------------------------

export type SendForumPostInput = {
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
};

export type SendForumPostResult = {
  slackConfigured: boolean;
  notifiedAt: string | null;
  threadTs: string | null;
  channelId: string | null;
  memberCount: number;
  reason?: string;
};

// Post the CURRENT per-member drafts to #forum-posts. If nothing's been drafted
// yet, draft first (so a bare "Send" still works). Never regenerates existing
// drafts — that's Redraft's job.
export async function sendForumPostToSlack(
  input: SendForumPostInput,
): Promise<SendForumPostResult> {
  const { supabase, workspaceId, source, sourceId } = input;
  const base: SendForumPostResult = {
    slackConfigured: false,
    notifiedAt: null,
    threadTs: null,
    channelId: null,
    memberCount: 0,
  };

  // Ensure drafts exist (fill any gaps, don't regenerate).
  let assignments = await loadAssignments(supabase, workspaceId, source, sourceId);
  if (assignments.length === 0) {
    await draftForumComments(input);
    assignments = await loadAssignments(supabase, workspaceId, source, sourceId);
  }
  if (assignments.length === 0) return { ...base, reason: "no team members" };

  const members = assignments.map((a) => ({ owner_label: a.owner_label, comment: a.comment }));

  // Bot path — threaded reply per member (enables the ✅ roundtrip).
  if (isSlackBotConfigured()) {
    const slackIds = await loadSlackIds(supabase, workspaceId);
    return await postThreaded({ input, members, slackIds });
  }

  // Webhook fallback — one inline message listing everyone's draft.
  const slack = await postForumPostMembers({
    subreddit: input.subreddit,
    title: input.title,
    url: input.url,
    members,
  });
  return {
    slackConfigured: slack.configured,
    notifiedAt: slack.ok ? new Date().toISOString() : null,
    threadTs: null,
    channelId: null,
    memberCount: members.length,
    reason: slack.reason,
  };
}

async function postThreaded(opts: {
  input: SendForumPostInput;
  members: { owner_label: string; comment: string | null }[];
  slackIds: Map<string, string | null>;
}): Promise<SendForumPostResult> {
  const { input, members, slackIds } = opts;
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
      memberCount: members.length,
      reason: parent.reason,
    };
  }

  for (const m of members) {
    if (!m.comment) continue;
    const uid = slackIds.get(m.owner_label);
    const mention = uid ? `<@${uid}>` : `*${m.owner_label}*`;
    const text = [`${mention} — your comment:`, ...m.comment.split("\n").map((l) => `> ${l}`)].join(
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
    memberCount: members.length,
  };
}

// ---- helpers --------------------------------------------------------------

async function loadAssignments(
  supabase: DB,
  workspaceId: string,
  source: ForumSource,
  sourceId: string,
): Promise<{ owner_label: string; comment: string | null }[]> {
  const { data } = await supabase
    .from("forum_comment_assignments")
    .select("owner_label, comment")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", sourceId)
    .order("owner_label", { ascending: true });
  return (data ?? []).map((r) => ({ owner_label: r.owner_label, comment: r.comment }));
}

async function loadSlackIds(supabase: DB, workspaceId: string): Promise<Map<string, string | null>> {
  const { data } = await supabase
    .from("reddit_accounts")
    .select("owner_label, slack_user_id")
    .eq("workspace_id", workspaceId);
  const map = new Map<string, string | null>();
  for (const r of data ?? []) if (!map.has(r.owner_label)) map.set(r.owner_label, r.slack_user_id);
  return map;
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
      out.push({ account_id: r.id, owner_label: r.owner_label, slack_user_id: r.slack_user_id });
    }
    return out;
  }

  // Roster never seeded — fall back to the known team names.
  return FORUM_TEAM.map((owner_label) => ({ account_id: null, owner_label, slack_user_id: null }));
}
