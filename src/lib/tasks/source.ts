/**
 * Where a task came from.
 *
 * `tasks` has no `source` column, so this is derived from the shape the three
 * generators leave behind:
 *   - tracking/open            → title "Hot lead: …", type call, created_by null
 *   - sequences/stop-on-reply  → title "Follow up with … — replied to …", enrollment_id set
 *   - cron/check-replies       → title "Reply from …", type email, created_by null
 *   - the UI / API POST        → created_by set
 *
 * Keep TASK_SOURCE_TITLE_PREFIX in sync with those generators — the API filters
 * on the same prefixes so client and server agree on what a tab contains.
 */
export type TaskSource = "hot_lead" | "reply" | "manual";

export const TASK_SOURCE_TITLE_PREFIX = {
  hot_lead: "Hot lead:",
  reply_follow_up: "Follow up with ",
  reply_inbound: "Reply from ",
} as const;

type SourceInput = {
  title: string;
  created_by: string | null;
  enrollment_id: string | null;
};

export function taskSource(task: SourceInput): TaskSource {
  if (task.created_by) return "manual";
  if (task.title.startsWith(TASK_SOURCE_TITLE_PREFIX.hot_lead)) return "hot_lead";
  if (
    task.enrollment_id ||
    task.title.startsWith(TASK_SOURCE_TITLE_PREFIX.reply_follow_up) ||
    task.title.startsWith(TASK_SOURCE_TITLE_PREFIX.reply_inbound)
  ) {
    return "reply";
  }
  return "manual";
}
