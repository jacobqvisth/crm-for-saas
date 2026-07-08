import { generateForumComment } from "./comment";
import { postForumPost } from "@/lib/slack/notify";

// Fan-out when a forum post is marked posted: draft a Reddit reply (if we don't
// have one yet) and post the link + reply to #forum-posts. Best-effort — the
// caller should never fail the mark-posted action if this errors. Returns the
// (possibly newly-drafted) comment and a notified timestamp to persist.
export type NotifyForumPostedInput = {
  subreddit: string;
  tone?: string | null;
  rulesNote?: string | null;
  title: string;
  body?: string | null;
  url: string;
  existingComment?: string | null;
  /** When true, redraft the comment even if one exists. */
  forceRegenerate?: boolean;
};

export type NotifyForumPostedResult = {
  comment: string | null;
  notifiedAt: string | null;
  slackConfigured: boolean;
  reason?: string;
};

export async function notifyForumPosted(
  input: NotifyForumPostedInput,
): Promise<NotifyForumPostedResult> {
  let comment = input.existingComment ?? null;
  if (!comment || input.forceRegenerate) {
    const gen = await generateForumComment({
      subreddit: input.subreddit,
      tone: input.tone,
      rulesNote: input.rulesNote,
      title: input.title,
      body: input.body,
    });
    if (gen.ok) comment = gen.comment;
  }

  const slack = await postForumPost({
    subreddit: input.subreddit,
    title: input.title,
    url: input.url,
    comment,
  });

  return {
    comment,
    notifiedAt: slack.ok ? new Date().toISOString() : null,
    slackConfigured: slack.configured,
    reason: slack.reason,
  };
}
