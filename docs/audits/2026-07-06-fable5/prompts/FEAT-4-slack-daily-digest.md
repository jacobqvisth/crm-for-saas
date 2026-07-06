# FEAT-4 · Slack daily digest

- **Runner:** Sonnet · **Effort:** S · **Priority:** P1 · **Repo:** `~/crm-for-saas`

## Context
Work is discoverable only by opening the app. Slack infra already exists but only alerts on infra, not sales: `src/lib/slack/notify.ts` and `src/lib/domain-health/notify.ts` (webhook via `SLACK_ALERT_WEBHOOK_URL`). Building blocks: `tasks_workspace_due` index, inbox needs-reply state (`replied_at`), the cron pattern in `vercel.json`.

## PROMPT
Add a daily sales digest to Slack.

1. New cron route `src/app/api/cron/slack-digest/route.ts` (export `GET`, guarded by `requireCronSecret`/CRON_SECRET), scheduled in `vercel.json` for a weekday morning (Stockholm time).
2. Message builder composing: tasks due today / overdue (count + top few), inbox "needs reply" count, new "interested" replies since yesterday (uses FEAT-1's intent if present, else lead_status changes), and optionally sends/replies in the last 24h. Use a per-rep breakdown if easy.
3. Post via the existing Slack webhook helper (`lib/slack/notify.ts`). Use a separate `SLACK_DIGEST_WEBHOOK_URL` if Jacob wants a different channel; else reuse.
4. Make it resilient (a query failure degrades the digest, doesn't 500 the cron; `reportError`).

### Definition of done
- A cron posts a formatted daily digest to Slack.
- Scheduled in vercel.json; guarded by the cron secret; exports GET.
- `npm run lint` passes.

### Verify
Invoke the route locally with the cron secret and a test webhook URL → a well-formatted message arrives with real counts. Confirm the schedule entry in vercel.json.
