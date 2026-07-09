# Forums → Slack: per-member comments + ✅ roundtrip (one-time setup)

The Forums flow drafts a **distinct Reddit comment for each team member** and
fans them out to `#forum-posts` as a parent message + one **threaded reply per
person**. When a teammate reacts ✅ on their own reply, the CRM marks that
member's comment as posted (`confirmed_via = slack_reaction`).

Two levels of functionality:

| Works with… | What you get |
|---|---|
| The existing `SLACK_FORUM_POSTS_WEBHOOK_URL` (already set) | Per-member comments posted as one inline message; mark "X posted this" **in the CRM**. No threading, no ✅ roundtrip. |
| A **bot token + signing secret + Event Subscriptions** (steps below) | Threaded reply per member **and** the ✅→CRM roundtrip. |

Everything already works at the first level today. The steps below unlock the
threaded + reaction behavior.

## One-time Slack app setup

Use the existing **CRM** Slack app (app id `A0BDFGBHWGZ`, workspace `codeoc` /
`T066TLJRMCG`).

1. **Bot token scopes** — App → *OAuth & Permissions* → Bot Token Scopes, add:
   - `chat:write` (post the parent + threaded replies)
   - `reactions:read` (receive ✅ events)
   Reinstall the app to the workspace if prompted. Copy the **Bot User OAuth
   Token** (`xoxb-…`).

2. **Invite the bot to the channel** — in `#forum-posts`, type
   `/invite @CRM` (or whatever the bot is named). It must be a member to post.

3. **Get the channel id** — open `#forum-posts` → channel name → *About* →
   bottom shows `Channel ID` (starts with `C…`). Or right-click the channel →
   *Copy link*; the id is the last path segment.

4. **Signing secret** — App → *Basic Information* → *App Credentials* →
   **Signing Secret** (used to verify inbound events).

5. **Add three env vars to Vercel** (Production) and redeploy:
   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_FORUM_POSTS_CHANNEL_ID=C0…        # #forum-posts channel id
   SLACK_SIGNING_SECRET=…                   # from step 4
   ```
   CLI: `vercel link --yes --project crm-for-saas` then
   `vercel env add SLACK_BOT_TOKEN production` (×3) and
   `vercel redeploy <prod-url>`.

6. **Enable Event Subscriptions** — App → *Event Subscriptions* → toggle On →
   Request URL:
   ```
   https://crm-for-saas.vercel.app/api/slack/events
   ```
   Slack sends a verification challenge; the endpoint answers it (it must
   already have `SLACK_SIGNING_SECRET`, so do step 5 first). Under
   *Subscribe to bot events*, add:
   - `reaction_added`
   - `reaction_removed`
   Save. Reinstall if Slack asks.

7. *(optional)* **Real @-mentions** — in the CRM under Forums → *Reddit
   accounts*, edit each teammate and paste their **Slack member ID**
   (Slack profile → *More* → *Copy member ID*, `U…`). Without it the thread
   uses plain names.

## How to verify it end-to-end

1. On `/forums/distribution`, mark a rec **posted** with a URL.
2. `#forum-posts` gets a parent message + one threaded reply per active roster
   member, each with that member's own comment.
3. React ✅ on one of the threaded replies → within a couple seconds the CRM
   shows that member as **posted · via Slack ✅** on the card.
4. Remove the ✅ → it reverts to *suggested* (only if it was reaction-confirmed;
   a CRM manual mark is never undone by a reaction).

## Notes

- No session exists on a Slack webhook, so `/api/slack/events` authenticates by
  verifying the signing secret and uses the service-role Supabase client.
- The reaction maps to a member by the **message ts** of their threaded reply
  (stored on `forum_comment_assignments.slack_message_ts`) — so it's correct no
  matter who physically clicks, and needs no Slack-user-ID mapping.
- "Redraft + resend to Slack" on a card regenerates every member's comment and
  posts a fresh thread.
