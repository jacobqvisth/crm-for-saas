# Claude Code Prompt — Phase 1: Project Scaffolding + Auth + Core UI

Paste this entire prompt into Claude Code to kick off the build.

---

## CONTEXT

I'm building a CRM with email sequencing (like HubSpot Sales + Lemlist) for our SaaS company. The Supabase database is already fully set up with all tables, indexes, RLS policies, and helper functions. Your job is to scaffold the Next.js application and connect it to this existing database.

## SUPABASE PROJECT (ALREADY CREATED — DO NOT CREATE TABLES)

```
Project ID: wdgiwuhehqpkhpvdzzzl
URL: https://wdgiwuhehqpkhpvdzzzl.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkZ2l3dWhlaHFwa2hwdmR6enpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNjUsImV4cCI6MjA4OTg0ODI2NX0.2PQ5U5UTX4eZ45DaerAY93JNy6K5Na48Cw5LZaWPRY
Region: eu-north-1 (Stockholm)
```

## EXISTING DATABASE TABLES

The following tables already exist in Supabase. DO NOT run any CREATE TABLE statements. Just connect to them.

**Core CRM:** workspaces, workspace_members, companies, contacts, pipelines, deals, deal_contacts, activities
**Lists:** contact_lists, contact_list_members
**Email Sequencing:** email_templates, sequences, sequence_steps, sequence_enrollments, email_queue, email_events
**Infrastructure:** gmail_accounts, unsubscribes

**Helper functions already in DB:**
- `get_user_workspace_ids()` — returns workspace IDs for the authenticated user
- `get_next_send_time(p_after, p_send_days, p_start_hour, p_end_hour, p_timezone)` — calculates next valid send time within a sequence's send window
- `get_sequence_stats(p_sequence_id)` — returns enrollment counts, sent/open/click/reply stats for a sequence
- `reset_daily_send_counts()` — resets Gmail account daily send counters
- `update_updated_at()` — trigger function that auto-updates updated_at columns

**RLS is enabled on ALL tables**, scoped to workspace_id via the `get_user_workspace_ids()` function.

## TASK: SCAFFOLD THE PROJECT

### Step 1: Initialize Next.js project

```bash
npx create-next-app@latest crm-for-saas --typescript --tailwind --app --src-dir --eslint
cd crm-for-saas
```

### Step 2: Install dependencies

```bash
npm install @supabase/supabase-js @supabase/ssr
npm install @hello-pangea/dnd                    # drag-and-drop for pipeline
npm install recharts                              # charts for dashboard
npm install lucide-react                          # icons
npm install date-fns                              # date formatting
npm install zod                                   # validation
npm install react-hot-toast                       # notifications
npm install papaparse                             # CSV parsing for imports
npm install @types/papaparse --save-dev
```

### Step 3: Environment variables

Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://wdgiwuhehqpkhpvdzzzl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkZ2l3dWhlaHFwa2hwdmR6enpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNjUsImV4cCI6MjA4OTg0ODI2NX0.2PQ5U5UTX4eZ45DaerAY93JNy6K5Na48Cw5LZaWPRY
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Add `.env.local` to `.gitignore` if not already there.

### Step 4: Create the TypeScript types file

Create `src/lib/database.types.ts` with the Supabase-generated types. The database has these tables with these key fields:

- **contacts**: id, workspace_id, email, first_name, last_name, phone, company_id, status (active/bounced/unsubscribed/archived), lead_status (new/contacted/qualified/customer/churned), custom_fields (JSONB), last_contacted_at
- **companies**: id, workspace_id, name, domain, industry, employee_count, annual_revenue, custom_fields
- **deals**: id, workspace_id, pipeline_id, name, amount, stage, probability, company_id, owner_id, expected_close_date, custom_fields
- **pipelines**: id, workspace_id, name, stages (JSONB array of {name, order, probability, color})
- **sequences**: id, workspace_id, name, status (draft/active/paused/archived), settings (JSONB with send_days, send_start_hour, send_end_hour, timezone, daily_limit_per_sender, stop_on_reply, sender_rotation)
- **sequence_steps**: id, sequence_id, step_order, type (email/delay/condition), delay_days, delay_hours, template_id, subject_override, body_override, condition_type (opened/clicked/replied), condition_branch_yes, condition_branch_no
- **email_queue**: id, workspace_id, enrollment_id, step_id, contact_id, sender_account_id, to_email, subject, body_html, status (scheduled/sending/sent/failed/cancelled), scheduled_for, sent_at, tracking_id, gmail_message_id
- **email_events**: id, tracking_id, email_queue_id, event_type (open/click/reply/bounce/unsubscribe), link_url, user_agent, ip_address
- **gmail_accounts**: id, workspace_id, user_id, email_address, display_name, access_token, refresh_token, token_expires_at, daily_sends_count, max_daily_sends, status

Generate proper TypeScript types from these, or use `npx supabase gen types typescript --project-id wdgiwuhehqpkhpvdzzzl > src/lib/database.types.ts` if the CLI is available.

### Step 5: Supabase client helpers

Create `src/lib/supabase/client.ts` (browser client) and `src/lib/supabase/server.ts` (server client using cookies) following the latest @supabase/ssr patterns for Next.js App Router.

Create `src/lib/supabase/middleware.ts` with a `updateSession` function that refreshes the auth token on every request.

Create `src/middleware.ts` that:
- Calls updateSession on every request
- Redirects unauthenticated users from /dashboard/* routes to /login
- Redirects authenticated users from /login to /dashboard

### Step 6: Auth pages

Create `src/app/(auth)/login/page.tsx`:
- Clean login page with Google OAuth button ("Sign in with Google Workspace")
- Use Supabase Auth `signInWithOAuth({ provider: 'google' })`
- Minimal, professional design — centered card on a light gray background

Create `src/app/(auth)/auth/callback/route.ts`:
- Handle the OAuth callback
- Exchange code for session
- After first login, check if user has a workspace — if not, create one and add them as owner
- Redirect to /dashboard

### Step 7: Dashboard layout

Create `src/app/(dashboard)/layout.tsx` with:
- Left sidebar (240px wide, collapsible):
  - Logo/app name at top
  - Nav items with icons (use lucide-react): Dashboard, Contacts, Companies, Deals, Sequences, Lists, Templates, Settings
  - Active state highlighting
  - User avatar + name at bottom with sign-out
- Main content area with top bar showing current page title
- Use Tailwind for all styling — no component library except shadcn/ui if you want (install via npx shadcn@latest init)
- Color scheme: white sidebar, slate-50 content background, indigo-600 as primary accent

### Step 8: Dashboard page

Create `src/app/(dashboard)/dashboard/page.tsx`:
- Top row: 6 metric cards (Total Contacts, Active Sequences, Emails Sent Today, Open Rate 7d, Reply Rate 7d, Pipeline Value)
- Query these from the real Supabase tables (it's fine if they show 0 for now)
- Below: Two-column layout
  - Left: "Recent Activity" feed — query last 20 activities ordered by created_at desc
  - Right: "Pipeline Summary" — mini bar chart of deal count per stage using Recharts
- Make it responsive (stack on mobile)

### Step 9: Workspace context

Create `src/lib/hooks/use-workspace.ts`:
- React context that loads the current user's workspace on mount
- Provides workspace_id to all child components
- Used in every data query to scope by workspace

### Step 10: Initialize GitHub

```bash
git init
git add .
git commit -m "Initial scaffold: Next.js + Supabase + Auth + Dashboard layout"
git remote add origin https://github.com/jacobqvisth/crm-for-saas.git
git push -u origin main
```

## IMPORTANT RULES

1. DO NOT create any database tables — they already exist in Supabase
2. All data queries must include `workspace_id` in the filter (RLS enforces this too, but be explicit)
3. Use Server Components for data fetching where possible, Client Components only for interactivity
4. Every page should have a loading.tsx skeleton
5. Use TypeScript strictly — no `any` types
6. Handle errors gracefully — show toast notifications for failures
7. Make the UI clean and professional — this is a business tool, not a toy

## FOLDER STRUCTURE TO CREATE

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── contacts/
│   │   │   ├── page.tsx          (table view — build in Phase 2)
│   │   │   └── [id]/page.tsx     (detail — build in Phase 2)
│   │   ├── companies/
│   │   │   ├── page.tsx          (placeholder for now)
│   │   │   └── [id]/page.tsx     (placeholder)
│   │   ├── deals/page.tsx        (placeholder)
│   │   ├── sequences/
│   │   │   ├── page.tsx          (placeholder)
│   │   │   └── [id]/
│   │   │       ├── edit/page.tsx  (placeholder)
│   │   │       └── analytics/page.tsx (placeholder)
│   │   ├── lists/page.tsx        (placeholder)
│   │   ├── templates/page.tsx    (placeholder)
│   │   └── settings/
│   │       ├── page.tsx          (placeholder)
│   │       └── email/page.tsx    (placeholder)
│   ├── api/
│   │   └── tracking/
│   │       ├── open/[trackingId]/route.ts   (placeholder)
│   │       ├── click/[trackingId]/route.ts  (placeholder)
│   │       └── unsubscribe/[trackingId]/route.ts (placeholder)
│   ├── layout.tsx
│   └── page.tsx                  (redirect to /dashboard or /login)
├── components/
│   ├── ui/                       (shared UI components)
│   ├── sidebar.tsx
│   ├── activity-feed.tsx
│   └── metric-card.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── hooks/
│   │   └── use-workspace.ts
│   └── database.types.ts
└── middleware.ts
```

Build everything in this scaffold now. Placeholder pages should show the page title and a "Coming soon" message styled consistently. The dashboard, auth flow, and layout should be fully functional.
