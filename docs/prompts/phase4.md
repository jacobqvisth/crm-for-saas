# Phase 4: Gmail Integration

## Context
This is an existing Next.js 16 + Supabase CRM project. Phases 1-3 are complete (scaffolding, auth, contacts, companies, CSV import, deals pipeline Kanban board). The database already has all tables including `gmail_accounts`, `email_queue`, `email_events`, and `unsubscribes`. RLS policies are in place on all tables.

Read CLAUDE.md at the project root for architecture details, conventions, and route structure before starting.

## Important Project Details
- **Google Workspace domain**: wrenchlane.com (jacob@wrenchlane.com is the primary account)
- **Google Cloud project**: Already exists with OAuth consent screen configured (Internal, for Google Workspace)
- **Supabase project ID**: wdgiwuhehqpkhpvdzzzl
- **Auth**: Users log in via Google OAuth through Supabase Auth — this is SEPARATE from the Gmail API OAuth. Users need to do a second OAuth flow specifically to grant Gmail send/read permissions.
- **Route structure**: Routes are `/settings`, `/contacts`, `/deals` etc. (NOT prefixed with `/dashboard/`). See CLAUDE.md.

## Existing Database Schema (already created, do NOT run migrations)
```sql
CREATE TABLE gmail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  email_address TEXT NOT NULL,
  display_name TEXT,
  access_token TEXT,           -- encrypted at rest
  refresh_token TEXT,          -- encrypted at rest
  token_expires_at TIMESTAMPTZ,
  daily_sends_count INTEGER DEFAULT 0,
  daily_sends_reset_at TIMESTAMPTZ,
  is_warmup BOOLEAN DEFAULT false,
  max_daily_sends INTEGER DEFAULT 80,
  status TEXT CHECK (status IN ('active','disconnected','rate_limited')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),
  sender_account_id UUID REFERENCES gmail_accounts(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  status TEXT CHECK (status IN ('scheduled','sending','sent','failed','cancelled')) DEFAULT 'scheduled',
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  gmail_message_id TEXT,
  tracking_id UUID DEFAULT gen_random_uuid(),
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

### 1. Environment Variables Setup
Add these to `.env.local.example` (NOT .env.local itself — never touch that file):
```
GOOGLE_CLIENT_ID=           # From Google Cloud Console
GOOGLE_CLIENT_SECRET=       # From Google Cloud Console
ENCRYPTION_KEY=             # 32-byte hex key for encrypting Gmail tokens
```

Create a helper at `src/lib/encryption.ts` that encrypts/decrypts Gmail tokens using AES-256-GCM with the ENCRYPTION_KEY env var. Tokens must NEVER be stored in plaintext.

### 2. Gmail OAuth Flow
This is a SEPARATE OAuth flow from the login auth. Users are already logged in via Supabase Auth (Google OAuth for login). This flow grants additional Gmail API permissions.

**Connect endpoint** — `src/app/api/auth/gmail/connect/route.ts`:
- Generate a Google OAuth2 authorization URL with these scopes:
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/gmail.modify`
- Set `access_type: 'offline'` and `prompt: 'consent'` to ensure refresh token is returned
- Include `state` parameter with the authenticated user's ID (verify it in callback)
- Redirect the user to Google's consent screen

**Callback endpoint** — `src/app/api/auth/gmail/callback/route.ts`:
- Exchange the authorization code for tokens
- Encrypt both access_token and refresh_token before storing
- Fetch the user's Gmail profile (email address, display name) via Gmail API
- Insert into `gmail_accounts` table with workspace_id, user_id, encrypted tokens, email_address
- Redirect back to `/settings/email` with success message

**Token refresh helper** — `src/lib/gmail/token-refresh.ts`:
- Function that checks if access_token is expired (compare token_expires_at to now)
- If expired, use refresh_token to get a new access_token from Google
- Update the encrypted access_token and token_expires_at in the database
- Return the valid (decrypted) access_token
- If refresh fails (e.g., user revoked access), mark account status as 'disconnected'

### 3. Gmail Sending Engine — `src/lib/gmail/send.ts`
Create the core email sending function:

```typescript
async function sendEmail(params: {
  accountId: string;        // gmail_accounts.id
  to: string;               // recipient email
  subject: string;
  htmlBody: string;
  textBody?: string;
  trackingId?: string;      // for open/click tracking (Phase 6)
  replyToMessageId?: string; // for threading
}): Promise<{ success: boolean; messageId?: string; error?: string }>
```

Implementation:
- Get the gmail_account record, decrypt the access_token (refresh if needed)
- Check daily_sends_count against max_daily_sends — reject if limit reached
- Build a proper MIME message with:
  - From: display_name <email_address>
  - To: recipient
  - Subject: subject
  - Content-Type: multipart/alternative (text + HTML parts)
  - List-Unsubscribe header (for CAN-SPAM — will use tracking_id in Phase 6)
- Base64url-encode the MIME message
- Send via Gmail API: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
- On success: increment daily_sends_count, return the Gmail message ID
- On 429 (rate limited): mark account as 'rate_limited', return error
- On 401 (auth expired): refresh token and retry once
- On other errors: return error message

Use the `googleapis` npm package (install it: `npm install googleapis`). Use the `google.gmail('v1')` client.

### 4. Sender Rotation — `src/lib/gmail/sender-rotation.ts`
When sending sequence emails, rotate across connected Gmail accounts:
- Function: `getNextSender(workspaceId: string): Promise<GmailAccount | null>`
- Query all gmail_accounts for the workspace where status = 'active' and daily_sends_count < max_daily_sends
- Round-robin: pick the account with the lowest daily_sends_count (distributes evenly)
- If no accounts have capacity, return null (all exhausted for today)
- Also export: `getTotalDailyCapacity(workspaceId: string)` — returns sum of remaining sends across all accounts

### 5. Daily Send Counter Reset
Create an API route `src/app/api/cron/reset-daily-sends/route.ts`:
- Resets daily_sends_count to 0 for all gmail_accounts where daily_sends_reset_at < now()
- Sets daily_sends_reset_at to tomorrow midnight (account's timezone, or UTC)
- This will be called by a cron job (Vercel cron or Inngest). For now, just create the endpoint.
- Protect it with a simple bearer token check (use a CRON_SECRET env var)

### 6. Email Settings Page — `/settings/email`
Create `src/app/(dashboard)/settings/email/page.tsx`:

**Connected Accounts section:**
- List all connected Gmail accounts for the workspace
- For each account show:
  - Email address and display name
  - Status badge (active / disconnected / rate_limited)
  - Daily sends: progress bar showing daily_sends_count / max_daily_sends
  - Max daily sends (editable number input, default 80)
  - "Disconnect" button (sets status to 'disconnected', clears tokens)
- "Connect Gmail Account" button at the top (triggers the OAuth flow)

**Sending Limits info panel:**
- Total daily capacity across all accounts
- Recommendation text: "For best deliverability, keep per-account sends under 80/day"

**Navigation:**
- Add an "Email" link to the settings page navigation (the settings page was updated in Phase 3 to be a nav hub)
- The URL should be `/settings/email`

### 7. Component Structure
Create components in `src/components/settings/`:
- `gmail-account-card.tsx` — card for each connected Gmail account
- `connect-gmail-button.tsx` — button that initiates the OAuth flow

Create lib files:
- `src/lib/gmail/send.ts` — sending engine
- `src/lib/gmail/sender-rotation.ts` — sender rotation logic
- `src/lib/gmail/token-refresh.ts` — token refresh helper
- `src/lib/gmail/client.ts` — shared Gmail API client setup
- `src/lib/encryption.ts` — AES-256-GCM encrypt/decrypt for tokens

### 8. Important Implementation Notes
- **NEVER store Gmail tokens in plaintext** — always encrypt with ENCRYPTION_KEY
- **The ENCRYPTION_KEY env var** should be a 32-byte hex string. Add a note in .env.local.example about generating one with `openssl rand -hex 32`
- **Rate limiting**: Space sends at least 60 seconds apart per account. The sending engine should enforce this (check last send time).
- **Google API library**: Use `googleapis` npm package (`npm install googleapis`)
- All Supabase queries must include workspace_id filter
- Use toast notifications for all user-facing actions
- Follow existing UI patterns from the contacts and deals pages
- The `gmail_accounts` table already has RLS policies — no need to create new ones

Do NOT create any new database tables or run migrations. Do NOT modify existing components outside of the settings/email feature unless adding navigation links.
