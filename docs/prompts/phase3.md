# Phase 3: Deals Pipeline (Kanban Board)

## Context
This is an existing Next.js 16 + Supabase CRM project. Phase 1 (scaffolding, auth) and Phase 2 (contacts, companies, CSV import) are complete. The database already has all tables including `pipelines`, `deals`, `deal_contacts`, and `activities`. RLS policies are in place on all tables using a `get_user_workspace_ids()` SECURITY DEFINER function.

## Important Project Details
- **Next.js 16.2.1** with App Router, TypeScript strict mode, Tailwind CSS 4
- **Route structure**: Uses `(dashboard)` route group — routes are `/deals`, `/contacts`, `/companies` etc. (NOT `/dashboard/deals`)
- **Sidebar** links are already at `/deals` — no need to change
- **Workspace context**: `useWorkspace()` hook from `@/lib/hooks/use-workspace` provides `workspaceId`
- **Supabase clients**: `@/lib/supabase/client` (browser) and `@/lib/supabase/server` (server components/API routes)
- **@hello-pangea/dnd** is already installed
- **Existing placeholder**: `src/app/(dashboard)/deals/page.tsx` currently shows a placeholder — replace it
- **Database types**: `@/lib/database.types` has generated Supabase types

## Existing Database Schema (already created, do NOT run migrations)
```sql
-- Pipelines (already has a default "Sales Pipeline" with 6 stages)
CREATE TABLE pipelines (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  name TEXT NOT NULL,
  stages JSONB NOT NULL -- [{name, order, probability, color}]
);

-- Deals
CREATE TABLE deals (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  pipeline_id UUID REFERENCES pipelines(id),
  name TEXT NOT NULL,
  amount NUMERIC,
  stage TEXT NOT NULL,
  probability INTEGER DEFAULT 0,
  company_id UUID REFERENCES companies(id),
  owner_id UUID REFERENCES auth.users(id),
  expected_close_date DATE,
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Deal-Contact junction
CREATE TABLE deal_contacts (
  deal_id UUID REFERENCES deals(id),
  contact_id UUID REFERENCES contacts(id),
  role TEXT DEFAULT 'participant',
  PRIMARY KEY (deal_id, contact_id)
);

-- Activities (already exists, used by contacts too)
CREATE TABLE activities (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  type TEXT CHECK (type IN ('email_sent','email_received','email_opened','email_clicked',
    'call','meeting','note','task','deal_stage_change','contact_created')),
  contact_id UUID REFERENCES contacts(id),
  company_id UUID REFERENCES companies(id),
  deal_id UUID REFERENCES deals(id),
  user_id UUID REFERENCES auth.users(id),
  subject TEXT,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ
);
```

The default pipeline has these stages:
```json
[
  {"name": "Lead", "order": 0, "probability": 10, "color": "#6366f1"},
  {"name": "Qualified", "order": 1, "probability": 25, "color": "#8b5cf6"},
  {"name": "Proposal", "order": 2, "probability": 50, "color": "#a855f7"},
  {"name": "Negotiation", "order": 3, "probability": 75, "color": "#d946ef"},
  {"name": "Closed Won", "order": 4, "probability": 100, "color": "#22c55e"},
  {"name": "Closed Lost", "order": 5, "probability": 0, "color": "#ef4444"}
]
```

## What to Build

### 1. Kanban Pipeline Board (`/deals` page)
Replace the placeholder at `src/app/(dashboard)/deals/page.tsx`.

**Board layout:**
- Fetch the workspace's pipeline and its stages from the `pipelines` table
- Render horizontal Kanban columns, one per stage, scrollable horizontally
- Column header: Stage name (colored dot using stage color), deal count, total amount in that stage
- Board header bar: Pipeline name, total pipeline value, weighted value (sum of amount × probability/100), filter controls

**Deal cards:**
- Show: Deal name, amount (formatted as currency), company name, expected close date, days in current stage
- Cards should be draggable between columns using `@hello-pangea/dnd`
- On drop: update the deal's `stage` and `probability` (from the target stage config) in Supabase
- On stage change: insert an activity record with type `deal_stage_change` and metadata `{from_stage, to_stage}`
- Click a card → open deal detail slide-over panel (don't navigate to a new page)

**"Add Deal" button:**
- Button at top of each column (or a global "+ New Deal" button)
- Opens a form: Deal name (required), amount, company (searchable dropdown from companies table), expected close date, stage (pre-filled if clicked from a column)
- On submit: insert into `deals` table with `workspace_id`, `pipeline_id`, and the selected stage
- Also create an activity record with type `deal_stage_change` metadata `{from_stage: null, to_stage: stageName}`

**Filters:**
- Filter by: company, amount range (min/max), expected close date range
- Filter bar at the top of the board

### 2. Deal Detail Slide-Over Panel
When clicking a deal card, open a slide-over panel (right side, overlay) — NOT a new page.

**Panel contents:**
- **Header**: Deal name (editable inline), stage badge (colored), close button
- **Fields section** (editable): Amount, Stage (dropdown), Expected close date, Company (searchable dropdown), Owner
- **Associated contacts**: List of contacts linked via `deal_contacts` table. Add/remove contacts with a searchable dropdown
- **Activity timeline**: Reuse the same timeline component pattern from contacts if available, filtered to `activities.deal_id`. Show stage changes, notes, emails
- **Add note button**: Quick-add a note (inserts activity with type `note` and `deal_id`)

### 3. Pipeline Settings Page
Create a new page at `src/app/(dashboard)/settings/pipelines/page.tsx`.

**Features:**
- List all pipelines for the workspace
- Edit pipeline: Reorder stages (drag and drop), rename stages, change stage colors and probabilities
- Add new stage to a pipeline
- Delete a stage (only if no deals are in that stage — show warning otherwise)
- Create new pipeline (for supporting multiple pipelines like "New Business" and "Renewals")
- Link to this page from the deals board (gear icon in the header)
- Also add a "Pipelines" sub-link in the Settings page or directly accessible from `/settings/pipelines`

### 4. Component Structure
Create these components in `src/components/deals/`:
- `pipeline-board.tsx` — main Kanban board with DnD context
- `pipeline-column.tsx` — single stage column with droppable area
- `deal-card.tsx` — draggable deal card
- `deal-detail-panel.tsx` — slide-over panel for deal details
- `add-deal-form.tsx` — form for creating new deals
- `deal-contacts.tsx` — associated contacts list with add/remove
- `deal-activity-timeline.tsx` — activity timeline filtered to deal

### 5. Important Implementation Notes
- All Supabase queries must include `workspace_id` filter (get it from `useWorkspace()` hook on client, or from the user's session on server)
- Use `if (!workspaceId) return;` guards with toast error messages (never fail silently)
- Format currency amounts with `Intl.NumberFormat` or similar
- Calculate "days in stage" from `updated_at` (which gets updated when stage changes via the `update_updated_at` trigger)
- The `update_updated_at` trigger already exists on the `deals` table — it auto-updates `updated_at` on any row change
- Use `lucide-react` for icons (already installed)
- Keep the UI consistent with the existing contacts/companies pages (same card styles, same page layout patterns)
- Use toast notifications for success/error feedback on all mutations

Do NOT create any new database tables or migrations — everything needed already exists. Do NOT modify any existing components outside of the deals feature unless absolutely necessary.
