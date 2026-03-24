# Phase 8: Dashboard + Reports

## Context
This is an existing Next.js 16 + Supabase CRM project. Phases 1-7 are complete (scaffolding, auth, contacts, companies, CSV import, deals pipeline, Gmail integration, email sequences, email tracking, contact lists). A basic dashboard page already exists at `/dashboard` with 6 metric cards (Total Contacts, Active Sequences, Emails Sent Today, Open Rate 7d, Reply Rate 7d, Pipeline Value), a Recent Activity feed, and a Pipeline Summary bar chart using recharts.

Read CLAUDE.md at the project root for architecture details, conventions, and route structure before starting.

## Existing Components (do NOT recreate — enhance or extend)
- `src/app/(dashboard)/dashboard/page.tsx` — Server component, fetches metrics in parallel
- `src/components/metric-card.tsx` — Card with title, value, icon, optional trend/subtitle
- `src/components/activity-feed.tsx` — Client component, shows recent activities
- `src/app/(dashboard)/dashboard/pipeline-chart.tsx` — Recharts bar chart for deals by stage

## Existing Database Tables (do NOT create new tables or run migrations)
Key tables for reporting:
- `contacts` (101 rows) — email, first_name, last_name, status, lead_status, company_id, created_at, last_contacted_at
- `companies` (99 rows) — name, domain, industry, employee_count, annual_revenue
- `deals` — name, amount, stage, probability, company_id, expected_close_date, created_at
- `pipelines` — stages JSONB array with name, color, order, probability
- `email_queue` — status (scheduled/sending/sent/failed/cancelled), sent_at, scheduled_for, tracking_id
- `email_events` — event_type (open/click/reply/bounce/unsubscribe), tracking_id, created_at
- `sequence_enrollments` — status (active/completed/replied/unsubscribed/bounced/paused), enrolled_at, completed_at
- `sequences` — name, status (draft/active/paused/archived)
- `activities` (101 rows) — type, subject, contact_id, company_id, deal_id, created_at
- `contact_lists` — name, is_dynamic, filters
- `gmail_accounts` — email_address, daily_sends_count, max_daily_sends, status
- `unsubscribes` — email, source, unsubscribed_at

## What to Build

### 1. Enhanced Dashboard Page
Rebuild `src/app/(dashboard)/dashboard/page.tsx` with a more comprehensive layout. Keep it as a server component for initial data fetch, but add client components for interactive elements.

**Top section — Date range selector:**
- Client component with preset buttons: Today, 7 Days, 30 Days, 90 Days, All Time
- Default to 30 Days
- All metrics and charts below respond to the selected range
- Store selection in URL search params (`?range=30d`) for shareability

**Metric cards row (keep existing 6, improve calculations):**
- Total Contacts — show count + trend vs previous period (e.g. "+12 this period")
- Active Sequences — count of sequences with status = 'active'
- Emails Sent — count in selected period (not just today), with trend
- Open Rate — opens / sent emails in period, as percentage
- Reply Rate — replies / sent emails in period, as percentage
- Pipeline Value — sum of deal amounts for open deals (exclude Closed Won/Lost)

Each card should use the existing `MetricCard` component's `trend` and `subtitle` props.

### 2. Email Performance Section
New client component: `src/components/dashboard/email-performance.tsx`

**Email volume chart (recharts AreaChart):**
- X axis: dates in selected range
- Y axis: count
- Two areas: Emails Sent (blue) and Emails Opened (green)
- Tooltip showing date, sent count, opened count
- Group by day for 7d/30d, by week for 90d

**Email stats cards (below the chart):**
- Total Sent | Total Opened | Total Clicked | Total Replied | Total Bounced | Unsubscribes
- Each as a small stat with count and percentage of total sent
- Use a compact horizontal layout

### 3. Sequence Performance Section
New client component: `src/components/dashboard/sequence-performance.tsx`

**Sequence summary table:**
- Columns: Sequence Name, Status badge, Enrolled, Active, Replied, Completed, Reply Rate %
- Data from: sequences joined with sequence_enrollments (group by status)
- Sort by reply rate descending
- Click row to navigate to `/sequences` (or sequence detail if it exists)
- Only show sequences that have at least 1 enrollment

### 4. Pipeline & Deals Section
Enhance the existing pipeline chart area.

**Pipeline funnel/bar chart (keep existing recharts, improve):**
- Show deal count AND total value per stage
- Dual bar or stacked display
- Use stage colors from pipeline.stages JSONB
- Exclude "Closed Won" and "Closed Lost" from the funnel (show separately)

**Deals closing soon:**
- List of deals with `expected_close_date` in the next 30 days
- Columns: Deal Name, Company, Amount, Stage, Expected Close
- Sort by expected_close_date ascending
- Max 10 rows, "View all deals →" link to `/deals`

**Won/Lost summary (for selected period):**
- Two cards side by side:
  - Closed Won: count + total value
  - Closed Lost: count + total value
  - Win rate: won / (won + lost) as percentage

### 5. Contact Growth Section
New client component: `src/components/dashboard/contact-growth.tsx`

**Contact growth chart (recharts LineChart):**
- X axis: dates in range
- Y axis: cumulative contact count
- Line showing total contacts over time (based on created_at)
- Group by day for 7d/30d, by week for 90d

**Lead status breakdown (recharts PieChart or horizontal bar):**
- Segments: New, Contacted, Qualified, Customer, Churned
- Show count and percentage for each
- Use distinct colors for each status

### 6. Recent Activity (enhance existing)
Keep the existing `ActivityFeed` component but add:
- "View All" link that opens a full activity log (can be a modal or link to a future page)
- Filter tabs above the feed: All, Emails, Calls, Deals, Notes
- Load more button (currently limited to 20)

### 7. Data Fetching Architecture
Since the dashboard is now interactive (date range, filters), restructure the data fetching:

**Server component** (`page.tsx`):
- Fetch only static/initial data (workspace info, pipeline stages)
- Render the layout shell

**Client component** (`dashboard-client.tsx`):
- Manage date range state (from URL params)
- Fetch all metrics via API routes or directly from Supabase client
- Show loading skeletons while data loads
- Refresh data when range changes

**Create API route** `src/app/api/dashboard/route.ts`:
- GET with query params: `?range=30d`
- Returns all dashboard metrics in one response
- Calculates: metric cards, email stats, sequence stats, pipeline stats, contact growth, recent activity
- All queries scoped to workspace_id (get from auth session)
- Calculate trends by comparing current period to previous period of same length

### 8. Loading & Empty States
- Show skeleton loading cards/charts while data loads
- Empty states for each section when no data exists:
  - No emails sent → "Connect a Gmail account and start a sequence to see email metrics"
  - No deals → "Create your first deal to see pipeline analytics"
  - No contacts → "Import contacts to get started"
- Each empty state should link to the relevant page

### 9. Component Structure
Create components in `src/components/dashboard/`:
- `dashboard-client.tsx` — Main client wrapper with date range state
- `date-range-selector.tsx` — Preset date range buttons
- `email-performance.tsx` — Email volume chart + stats
- `sequence-performance.tsx` — Sequence summary table
- `pipeline-section.tsx` — Enhanced pipeline chart + deals closing + won/lost
- `contact-growth.tsx` — Growth chart + lead status breakdown
- `dashboard-skeleton.tsx` — Loading skeletons for all sections

### 10. Important Implementation Notes
- Use recharts for all charts (already installed). Import from `recharts`.
- The existing `MetricCard` component already supports `trend` and `subtitle` props — use them.
- Date range calculations: "30d" means last 30 days from now. Trend = compare to the 30 days before that.
- All Supabase queries must include workspace_id filter.
- For the API route, use the server Supabase client and get workspace from the user's session.
- Use toast notifications for any errors.
- Follow existing UI patterns — white cards with slate-200 borders, rounded-xl, consistent spacing.
- Keep the overall layout responsive: single column on mobile, multi-column on desktop.
- Do NOT create new database tables or run migrations.
- Recharts `ResponsiveContainer` must always wrap charts.
