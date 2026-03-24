# Phase 5: Email Sequences (Lemlist-like Campaign System)

## Context
This is an existing Next.js 16 + Supabase CRM project. Phases 1-4 are complete (scaffolding, auth, contacts, companies, CSV import, deals pipeline, Gmail integration with OAuth, sending engine, sender rotation). The database already has all sequence-related tables. The Gmail sending engine is built at `src/lib/gmail/send.ts`.

Read CLAUDE.md at the project root for architecture details, conventions, and route structure before starting.

## Important Project Details
- **Route structure**: Routes are `/sequences`, `/contacts`, `/templates` etc. (NOT prefixed with `/dashboard/`). See CLAUDE.md.
- **Gmail sending**: Already built at `src/lib/gmail/send.ts` — exports `sendEmail({ accountId, to, subject, htmlBody, textBody, trackingId })`
- **Sender rotation**: Already built at `src/lib/gmail/sender-rotation.ts` — exports `getNextSender(workspaceId)`
- **Workspace context**: `useWorkspace()` hook from `@/lib/hooks/use-workspace` provides `workspaceId`
- **Supabase clients**: `@/lib/supabase/client` (browser) and `@/lib/supabase/server` (server)

## Existing Database Schema (already created, do NOT run migrations)
```sql
-- Email templates
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  variables TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sequences (the automation workflows)
CREATE TABLE sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT CHECK (status IN ('draft','active','paused','archived')) DEFAULT 'draft',
  settings JSONB DEFAULT '{
    "send_days": ["mon","tue","wed","thu","fri"],
    "send_start_hour": 9,
    "send_end_hour": 17,
    "timezone": "Europe/Stockholm",
    "daily_limit_per_sender": 80,
    "stop_on_reply": true,
    "stop_on_meeting_booked": true
  }',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sequence steps
CREATE TABLE sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  type TEXT CHECK (type IN ('email','delay','condition')) DEFAULT 'email',
  delay_days INTEGER DEFAULT 0,
  delay_hours INTEGER DEFAULT 0,
  template_id UUID REFERENCES email_templates(id),
  subject_override TEXT,
  body_override TEXT,
  condition_type TEXT,          -- 'opened','clicked','replied' for condition steps
  condition_branch_yes INTEGER, -- step_order to jump to if condition met
  condition_branch_no INTEGER,  -- step_order to jump to if not met
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sequence enrollments (one per contact per sequence)
CREATE TABLE sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  sender_account_id UUID REFERENCES gmail_accounts(id),
  status TEXT CHECK (status IN ('active','completed','replied','unsubscribed','bounced','paused')) DEFAULT 'active',
  current_step INTEGER DEFAULT 0,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, contact_id)
);

-- Email send queue
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

-- Email tracking events
CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id UUID NOT NULL,
  email_queue_id UUID REFERENCES email_queue(id),
  event_type TEXT CHECK (event_type IN ('open','click','reply','bounce','unsubscribe')) NOT NULL,
  link_url TEXT,
  user_agent TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unsubscribes (already has data potentially)
CREATE TABLE unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, email)
);
```

Helper function already exists:
```sql
-- get_next_send_time(workspace_id, after_timestamp) returns next valid send time within send window
-- get_sequence_stats(sequence_id) returns {enrolled, sent, opened, clicked, replied, bounced, unsubscribed}
```

## What to Build

### 1. Sequence List Page (`/sequences`)
Replace the existing placeholder at `src/app/(dashboard)/sequences/page.tsx`.

**Table view:**
- Columns: Name, Status (Draft/Active/Paused/Archived), Steps count, Enrolled, Sent, Open %, Reply %
- Status badge with colors (draft=gray, active=green, paused=yellow, archived=red)
- Quick actions per row: Activate, Pause, Duplicate, Archive
- "Create Sequence" button → navigates to `/sequences/new`
- Click row → navigates to `/sequences/[id]`

### 2. Sequence Detail/Overview Page (`/sequences/[id]`)
Create `src/app/(dashboard)/sequences/[id]/page.tsx`.

**Header:**
- Sequence name (editable inline), status badge
- Action buttons: Edit Steps, Add Contacts, Activate/Pause, Settings gear icon
- Stats bar: Enrolled, Sent, Opened (%), Clicked (%), Replied (%), Bounced (%)

**Tabs:**
- **Overview**: Visual step preview (read-only version of the builder showing the sequence flow)
- **Contacts**: Table of enrolled contacts with columns: Name, Email, Status (active/completed/replied/unsubscribed/bounced), Current Step, Enrolled date. Bulk actions: Pause, Resume, Remove
- **Analytics**: Per-step breakdown table: Step name/number, Sent count, Open %, Click %, Reply %. Simple bar chart showing the funnel (enrolled → sent → opened → replied)

### 3. Sequence Builder/Editor (`/sequences/[id]/edit`)
Create `src/app/(dashboard)/sequences/[id]/edit/page.tsx`. This is the most important UI.

**Visual step builder (vertical timeline layout like Lemlist):**
- Each step is a card connected by vertical lines/arrows
- Step types:
  - **Email step**: Shows subject line, preview of body, template name. Click to edit inline.
  - **Delay step**: Shows "Wait X days Y hours". Click to edit duration.
  - **Condition step**: Shows condition (e.g., "If opened previous email"). Shows two branches: Yes path and No path with step_order references.
- "Add Step" button between each card (dropdown: Email / Delay / Condition)
- Drag to reorder steps (update step_order in DB)
- Delete step button on each card

**Email step editor (inline or modal):**
- Subject line input
- Rich text body editor (use a simple textarea with HTML support, or contenteditable div — don't need a full WYSIWYG)
- Variable insertion: Button/dropdown that inserts variables like `{{first_name}}`, `{{last_name}}`, `{{company_name}}`, `{{email}}`, `{{unsubscribe_link}}`
- Option to select an existing template or create inline
- Preview button: Shows the email with sample data filled in

**Delay step editor:**
- Number inputs for days and hours
- Simple and clean

**Condition step editor:**
- Dropdown: "Previous email was opened" / "Previous email was clicked" / "Previous email was replied to"
- Two branch paths: "If yes → go to step X" / "If no → go to step Y"
- Dropdown selectors for the target steps

**Sequence settings panel (slide-over or separate section):**
- Send window: Checkboxes for days (Mon-Sun), start hour, end hour
- Timezone dropdown (default: Europe/Stockholm)
- Daily send limit per sender account
- Stop triggers: Checkboxes for "Stop on reply", "Stop on unsubscribe", "Stop on bounce"
- Sender account: Dropdown to select specific account or "Rotate across all"

### 4. Template Management (`/templates`)
Replace the existing placeholder at `src/app/(dashboard)/templates/page.tsx`.

**Template list:**
- Table: Name, Subject, Variables used, Last updated
- "Create Template" button
- Click to edit

**Template editor (inline or separate page):**
- Name, Subject, Body (HTML), Body (plain text auto-generated from HTML)
- Variable insertion (same as sequence email editor)
- Preview with sample data
- Save/Update/Delete

### 5. Enrollment System
Create `src/lib/sequences/enrollment.ts`:

**enrollContacts function:**
```typescript
async function enrollContacts(params: {
  sequenceId: string;
  contactIds: string[];
  workspaceId: string;
  senderAccountId?: string; // specific sender, or null for rotation
}): Promise<{ enrolled: number; skipped: number; reasons: string[] }>
```

Before enrolling each contact, check:
- Contact not already enrolled in this sequence (UNIQUE constraint)
- Contact email not in `unsubscribes` table
- Contact status is 'active' (not bounced/unsubscribed/archived)
- Sequence status is 'active' or 'draft'

For each valid contact:
1. Create `sequence_enrollment` record
2. Assign sender_account_id (specific or via rotation)
3. Get the first step of the sequence
4. If first step is an email: resolve variables, create `email_queue` entry with `scheduled_for` calculated using the sequence's send window settings and `get_next_send_time()`
5. If first step is a delay: calculate when the delay ends, then schedule the step after

**Add Contacts UI** (accessible from sequence detail page):
- Modal/slide-over with two tabs:
  - "Search": Search contacts by name/email, select multiple, enroll
  - "From List": Show contact lists, select a list to bulk-enroll all members
- Show enrollment summary after: "Enrolled X contacts, Skipped Y (already enrolled/unsubscribed/bounced)"

### 6. Sequence Execution Engine (API Routes — Inngest can be added later)
For now, build these as API routes that can be called by cron. We'll migrate to Inngest in a future phase.

**Process scheduled emails** — `src/app/api/cron/process-emails/route.ts`:
- Protected by CRON_SECRET bearer token
- Query `email_queue` WHERE status='scheduled' AND scheduled_for <= now()
- Group by sender_account_id, respect daily limits
- For each email:
  1. Check enrollment is still active
  2. Check contact not unsubscribed
  3. Resolve template variables (see variable resolution below)
  4. Call `sendEmail()` from `src/lib/gmail/send.ts`
  5. Update email_queue: status='sent', sent_at=now(), gmail_message_id
  6. Create activity record (type: 'email_sent')
  7. Advance the enrollment: increment current_step
  8. Schedule NEXT step:
     - If next step is email: create new email_queue entry with scheduled_for
     - If next step is delay: calculate delay end time, then schedule the email after the delay
     - If next step is condition: schedule a condition check (create an email_queue entry with a special status or a separate mechanism)
     - If no more steps: mark enrollment as 'completed'
  9. On send failure: increment retry_count, reschedule 15 min later (max 3 retries), then mark as 'failed'

**Check for replies** — `src/app/api/cron/check-replies/route.ts`:
- Protected by CRON_SECRET bearer token  
- For all active enrollments, check if a reply was received:
  - Query `email_events` for event_type='reply' linked to emails in the enrollment
  - OR check Gmail API for replies to sent message IDs (if reply tracking is set up)
- If reply detected and sequence has stop_on_reply=true:
  - Update enrollment status to 'replied'
  - Cancel all scheduled emails for this enrollment (set status='cancelled')
  - Create activity record (type: 'email_received')
  - Update contact.last_contacted_at

### 7. Variable Resolution — `src/lib/sequences/variables.ts`
Create a function that resolves template variables:

```typescript
function resolveVariables(template: string, contact: Contact, company?: Company): string
```

Variable mappings:
- `{{first_name}}` → contact.first_name (fallback: "there")
- `{{last_name}}` → contact.last_name (fallback: "")
- `{{email}}` → contact.email
- `{{company_name}}` → company.name via contact.company_id (fallback: "your company")
- `{{phone}}` → contact.phone (fallback: "")
- `{{custom.X}}` → contact.custom_fields['X'] (fallback: "")
- `{{unsubscribe_link}}` → generates URL: `${APP_URL}/api/tracking/unsubscribe/${tracking_id}`

Apply to both subject and body.

### 8. Component Structure
Create components in `src/components/sequences/`:
- `sequence-list.tsx` — table of sequences
- `sequence-header.tsx` — detail page header with stats
- `sequence-builder.tsx` — the visual step builder
- `step-card.tsx` — individual step card (email/delay/condition)
- `email-step-editor.tsx` — inline editor for email steps
- `delay-step-editor.tsx` — editor for delay steps
- `condition-step-editor.tsx` — editor for condition steps
- `variable-picker.tsx` — dropdown for inserting template variables
- `enroll-contacts-modal.tsx` — modal for adding contacts to sequence
- `sequence-contacts-tab.tsx` — enrolled contacts table
- `sequence-analytics-tab.tsx` — per-step analytics with funnel chart
- `sequence-settings.tsx` — settings panel

Create components in `src/components/templates/`:
- `template-list.tsx` — table of templates
- `template-editor.tsx` — create/edit template form

Create lib files:
- `src/lib/sequences/enrollment.ts` — enrollment logic
- `src/lib/sequences/variables.ts` — variable resolution
- `src/lib/sequences/scheduler.ts` — scheduling logic (calculate next send time respecting send windows)

### 9. Important Implementation Notes
- **CAN-SPAM compliance**: Every email MUST include `{{unsubscribe_link}}`. If the template doesn't contain it, append it automatically before sending.
- **Send windows**: Emails must only be scheduled within the sequence's send window (send_days + send_start_hour/send_end_hour + timezone). If the calculated send time falls outside the window, push to the next valid send time.
- **Variable fallbacks**: Never send an email with unresolved `{{variable}}` text. Always use fallback values.
- **Enrollment uniqueness**: One contact can only be enrolled once per sequence (enforced by UNIQUE constraint).
- All Supabase queries must include workspace_id filter
- Use toast notifications for all user-facing actions
- Follow existing UI patterns (same card styles, layouts)
- Use `lucide-react` for icons, `date-fns` for dates
- Use Recharts for the funnel/analytics charts (install if needed: `npm install recharts`)

Do NOT create any new database tables or run migrations. Do NOT modify existing components outside the sequences/templates features unless adding navigation links.
