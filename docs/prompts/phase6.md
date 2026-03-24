# Phase 6: Email Tracking (Open Pixel, Click Wrapping, Unsubscribe)

## Context
This is an existing Next.js 16 + Supabase CRM project. Phases 1-5 are complete (scaffolding, auth, contacts, companies, CSV import, deals pipeline, Gmail integration, email sequences with builder/enrollment/execution). The database already has `email_events` and `unsubscribes` tables. Tracking API route stubs exist at `src/app/api/tracking/`.

Read CLAUDE.md at the project root for architecture details, conventions, and route structure before starting.

## Important Project Details
- **Tracking route stubs already exist**: `src/app/api/tracking/open/[trackingId]/`, `src/app/api/tracking/click/[trackingId]/`, `src/app/api/tracking/unsubscribe/[trackingId]/` — check if they have implementations or are empty, then build/replace as needed
- **Email sending engine**: `src/lib/gmail/send.ts` — this is where tracking pixel and link wrapping injection should happen BEFORE the email is sent
- **Email queue**: Each `email_queue` row has a `tracking_id` (UUID) used to link tracking events back to the email
- **Variable resolution**: `src/lib/sequences/variables.ts` already handles `{{unsubscribe_link}}`
- **Process emails cron**: `src/app/api/cron/process-emails/route.ts` calls the sending engine

## Existing Database Schema (do NOT run migrations)
```sql
CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id UUID NOT NULL,
  email_queue_id UUID REFERENCES email_queue(id),
  event_type TEXT CHECK (event_type IN ('open','click','reply','bounce','unsubscribe')) NOT NULL,
  link_url TEXT,              -- for click events
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_email_events_tracking ON email_events(tracking_id);

CREATE TABLE unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, email)
);
```

## What to Build

### 1. Open Tracking (Pixel)
**Tracking pixel injection** — modify `src/lib/gmail/send.ts`:
- Before sending any email, append an invisible 1x1 tracking pixel to the HTML body:
  ```html
  <img src="${APP_URL}/api/tracking/open/${trackingId}" width="1" height="1" style="display:none;border:0;" alt="" />
  ```
- Use `NEXT_PUBLIC_APP_URL` env var (or a `TRACKING_DOMAIN` env var if set) for the base URL
- Only inject if the email has a `trackingId`

**Open tracking endpoint** — `src/app/api/tracking/open/[trackingId]/route.ts`:
- GET request handler
- Look up the `email_queue` row by `tracking_id` to get `email_queue_id` and `workspace_id`
- Deduplicate: only log the first open per tracking_id per hour (check if an 'open' event exists within the last hour for this tracking_id)
- Insert into `email_events`: event_type='open', tracking_id, email_queue_id, user_agent (from request headers), ip_address (from x-forwarded-for or request)
- Return a 1x1 transparent GIF image (hardcode the bytes: `Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')`)
- Set response headers: `Content-Type: image/gif`, `Cache-Control: no-store, no-cache, must-revalidate`
- This endpoint must be PUBLIC (no auth required) — email clients fetch it

### 2. Click Tracking (Link Wrapping)
**Link wrapping** — create `src/lib/tracking/link-wrapper.ts`:
- Function: `wrapLinks(html: string, trackingId: string, appUrl: string): string`
- Parse the HTML body and find all `<a href="...">` tags
- Replace each URL with: `${appUrl}/api/tracking/click/${trackingId}?url=${encodeURIComponent(originalUrl)}`
- **EXCLUDE** unsubscribe links from wrapping (any URL containing `/api/tracking/unsubscribe/` or `{{unsubscribe_link}}`)
- **EXCLUDE** mailto: links
- Integrate this into `src/lib/gmail/send.ts` — wrap links before building the MIME message

**Click tracking endpoint** — `src/app/api/tracking/click/[trackingId]/route.ts`:
- GET request handler
- Extract `url` query parameter (the original URL)
- Validate the URL (must start with http:// or https://)
- Look up `email_queue` by tracking_id for email_queue_id
- Insert into `email_events`: event_type='click', tracking_id, email_queue_id, link_url (original URL), user_agent, ip_address
- 302 redirect to the original decoded URL
- This endpoint must be PUBLIC

### 3. Unsubscribe Handling
**Unsubscribe endpoint** — `src/app/api/tracking/unsubscribe/[trackingId]/route.ts`:
- GET request handler (for link clicks from emails)
- Look up the `email_queue` row by tracking_id to get contact_id and workspace_id
- Look up the contact's email address
- Insert into `unsubscribes` table (workspace_id, email)
- Insert into `email_events`: event_type='unsubscribe', tracking_id, email_queue_id
- Update contact status to 'unsubscribed' in contacts table
- Cancel ALL active sequence enrollments for this contact (set status='unsubscribed', cancel scheduled emails)
- Return a simple HTML page: "You've been unsubscribed. You will no longer receive emails from us."
- This endpoint must be PUBLIC

**List-Unsubscribe header** — modify `src/lib/gmail/send.ts`:
- Add these headers to every outgoing email MIME message:
  ```
  List-Unsubscribe: <${appUrl}/api/tracking/unsubscribe/${trackingId}>
  List-Unsubscribe-Post: List-Unsubscribe=One-Click
  ```
- This enables one-click unsubscribe in Gmail/Outlook (RFC 8058)

**Also add POST handler** to the unsubscribe endpoint:
- POST request handler (for one-click unsubscribe from email clients)
- Same logic as GET but returns 200 OK instead of HTML page

### 4. Bounce Detection
**Bounce checker** — enhance `src/app/api/cron/check-replies/route.ts`:
- In addition to checking for replies, also check for bounces
- Look for emails from `mailer-daemon@` or `postmaster@` in the Gmail inbox
- Parse bounce messages to extract the bounced email address
- If bounce detected:
  - Insert email_event with event_type='bounce'
  - Update contact status to 'bounced'
  - Cancel all active enrollments for that contact
  - Create activity record

### 5. Tracking Integration into Sending Engine
Modify `src/lib/gmail/send.ts` to integrate all tracking before sending:

The send flow should be:
1. Receive email params (htmlBody, trackingId, etc.)
2. Wrap links in HTML body (click tracking)
3. Inject tracking pixel (open tracking)
4. Add List-Unsubscribe headers
5. Build MIME message
6. Send via Gmail API

### 6. Tracking Stats Display
**Update sequence analytics** — modify `src/components/sequences/sequence-analytics-tab.tsx`:
- Ensure open rate, click rate, and unsubscribe rate are calculated from `email_events`
- Per-step breakdown should show: Sent, Opened (count + %), Clicked (count + %), Replied (count + %)

**Contact activity timeline** — ensure tracking events appear:
- When an open/click/unsubscribe event is logged, it should be visible in the contact's activity timeline
- Create activity records for opens (first open only), clicks, and unsubscribes

**Sequence detail overview** — update stats bar on sequence detail page to show real tracking data

### 7. Component/File Structure
Create or modify:
- `src/lib/tracking/link-wrapper.ts` — link wrapping utility (NEW)
- `src/lib/tracking/pixel.ts` — tracking pixel injection utility (NEW)
- `src/app/api/tracking/open/[trackingId]/route.ts` — open tracking (REPLACE stub)
- `src/app/api/tracking/click/[trackingId]/route.ts` — click tracking (REPLACE stub)
- `src/app/api/tracking/unsubscribe/[trackingId]/route.ts` — unsubscribe (REPLACE stub)
- `src/lib/gmail/send.ts` — integrate tracking (MODIFY)
- `src/app/api/cron/check-replies/route.ts` — add bounce detection (MODIFY)

### 8. Important Implementation Notes
- **All tracking endpoints must be PUBLIC** — no auth required. Email clients and recipients must be able to hit these URLs.
- **The middleware matcher already excludes `/api/tracking/*`** from auth checks — verify this is still the case.
- **Deduplicate opens**: Email clients sometimes load the pixel multiple times. Only count one open per tracking_id per hour.
- **Use Supabase service role or direct insert for tracking endpoints** since there's no authenticated user. You may need to use the SUPABASE_SERVICE_ROLE_KEY for these inserts, or adjust RLS policies to allow public inserts on email_events. Check the current RLS on email_events and adjust if needed.
- **CAN-SPAM**: Every email must have an unsubscribe link. The variable resolver already handles `{{unsubscribe_link}}` — make sure it generates the correct URL format.
- **IP extraction**: Use `request.headers.get('x-forwarded-for')` or `request.headers.get('x-real-ip')` for the IP address.
- Do NOT create new database tables or run migrations.
- Follow existing code patterns and UI styles.
