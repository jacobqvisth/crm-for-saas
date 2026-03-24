# Claude Code Prompt — Phase 2: Contacts + Companies + CSV Import

## CONTEXT

This is a CRM app (Next.js 16, App Router, TypeScript, Tailwind CSS 4, Supabase). Phase 1 is complete — scaffolding, auth with Google OAuth, dashboard layout with sidebar, workspace context, and placeholder pages are all merged to main.

The Supabase database already has all tables, indexes, and RLS policies set up. DO NOT create or modify any database tables.

Now build the Contacts and Companies modules — the core data views. This should feel like HubSpot's contact management: clean table views, detail pages with activity timelines, and a CSV import flow that can handle 10,000+ contacts.

Pull the latest main before starting.

## SUPABASE DETAILS (already configured in .env.local)

```
Project ID: wdgiwuhehqpkhpvdzzzl
URL: https://wdgiwuhehqpkhpvdzzzl.supabase.co
```

## EXISTING DATABASE TABLES YOU'LL USE

**contacts**: id, workspace_id, email, first_name, last_name, phone, company_id (FK → companies), status (active/bounced/unsubscribed/archived), lead_status (new/contacted/qualified/customer/churned), custom_fields (JSONB), last_contacted_at, created_at, updated_at

**companies**: id, workspace_id, name, domain, industry, employee_count, annual_revenue, custom_fields (JSONB), created_at, updated_at

**activities**: id, workspace_id, type (email_sent/email_received/email_opened/email_clicked/call/meeting/note/task/deal_stage_change/contact_created), contact_id, company_id, deal_id, user_id, subject, body, metadata (JSONB), created_at

**contact_lists**: id, workspace_id, name, description, is_dynamic, filters (JSONB), created_at
**contact_list_members**: list_id, contact_id, added_at

**deals**: id, workspace_id, pipeline_id, name, amount, stage, company_id, owner_id, expected_close_date
**deal_contacts**: deal_id, contact_id, role

**sequence_enrollments**: id, sequence_id, contact_id, status, current_step, enrolled_at

## TASK 1: CONTACTS TABLE PAGE — /contacts

Replace the placeholder page with a full data table:

### Table view
- Columns: Checkbox (for bulk select), Name (first + last), Email, Company (clickable link to company), Lead Status (colored badge), Last Contacted (relative time like "3 days ago"), Created (date)
- Default sort: created_at DESC
- Pagination: 50 per page with Previous/Next buttons and "Showing 1-50 of 10,234" text
- Loading skeleton while data loads

### Search
- Search input at top that filters by first_name, last_name, or email using Supabase `or` with `ilike`
- Debounce 300ms so it doesn't fire on every keystroke
- Clear button to reset search

### Filters
- Filter bar below search with dropdown selects:
  - Lead Status: All, New, Contacted, Qualified, Customer, Churned
  - Status: All, Active, Bounced, Unsubscribed, Archived
  - Company: searchable dropdown of companies in workspace
- Filters update the URL query params so the page is shareable/bookmarkable
- "Clear filters" button when any filter is active

### Bulk actions
- Checkbox in header row to select all on current page
- When contacts are selected, show a floating action bar at bottom with:
  - "X contacts selected" count
  - "Change Lead Status" dropdown
  - "Add to List" button (shows modal to pick/create a list)
  - "Delete" button (with confirmation modal)
- All bulk operations use Supabase batch updates

### Top action buttons
- "Add Contact" button → opens a slide-over panel with a form:
  - Fields: First Name, Last Name, Email (required), Phone, Company (searchable dropdown with "Create new" option), Lead Status dropdown
  - Save creates the contact AND creates a 'contact_created' activity
- "Import CSV" button → navigates to /contacts/import

## TASK 2: CONTACT DETAIL PAGE — /contacts/[id]

Three-column layout (responsive — stacks on mobile):

### Left column (300px): Contact Info Card
- Avatar circle with initials (first letter of first + last name)
- Full name as heading, email below
- Editable fields (click to edit, save on blur or Enter):
  - First Name, Last Name, Email, Phone
  - Company (searchable dropdown)
  - Lead Status (dropdown with colored badges)
  - Status (dropdown)
- Custom fields section: renders all keys from custom_fields JSONB as editable rows
  - "Add custom field" button to add new key-value pair
- "Delete contact" button at bottom (with confirmation)

### Center column (flexible width): Activity Timeline
- Reverse chronological feed of ALL activities for this contact
- Each activity shows: Icon (based on type), Title, Description preview, Timestamp (relative)
- Activity types and their display:
  - email_sent: Mail icon, "Email sent: {subject}", preview of body
  - email_received: Mail icon (different color), "Reply received: {subject}"
  - email_opened: Eye icon, "Opened: {subject}"
  - email_clicked: MousePointer icon, "Clicked link in: {subject}", shows URL
  - note: FileText icon, shows body
  - call: Phone icon, "Call logged", shows notes in body
  - meeting: Calendar icon, "Meeting: {subject}"
  - contact_created: UserPlus icon, "Contact created"
  - deal_stage_change: ArrowRight icon, "Deal {deal name} moved to {stage}"
- "Add Note" button at top — inline form that creates activity of type 'note'
- "Log Call" button — inline form with subject + notes, creates activity of type 'call'
- Use Supabase real-time subscription to show new activities instantly (no refresh needed)
- Pagination: Load 20 at a time with "Load more" button

### Right column (280px): Associations
- **Company card**: Shows company name, domain, industry. Click to go to /companies/[id]
- **Deals section**: List of deals this contact is on (via deal_contacts junction table). Each shows deal name, amount, stage badge. "Add to deal" button.
- **Lists section**: Lists this contact belongs to (via contact_list_members). Each shows list name. "Add to list" button.
- **Sequences section**: Active sequence enrollments (via sequence_enrollments). Shows sequence name, current step, status badge.

## TASK 3: COMPANIES TABLE PAGE — /companies

Same structure as contacts table but for companies:

### Table view
- Columns: Name, Domain (clickable link), Industry, Contacts (count), Deals (count), Created
- Contacts count = number of contacts with this company_id
- Deals count = number of deals with this company_id
- Search by name or domain
- Sort by name (default), contacts count, deals count

### Add Company
- "Add Company" button → slide-over panel:
  - Fields: Name (required), Domain, Industry (dropdown with common options + custom), Employee Count, Annual Revenue
  - Save creates the company

## TASK 4: COMPANY DETAIL PAGE — /companies/[id]

Two-column layout:

### Left column: Company Info Card
- Company name as heading, domain as link below
- Editable fields: Name, Domain, Industry, Employee Count, Annual Revenue
- Custom fields section (same as contacts)
- "Delete company" button

### Right/main column: Tabs
- **Contacts tab**: Table of all contacts with this company_id. Same columns as main contacts table but filtered. "Add contact" button that pre-fills the company.
- **Deals tab**: Table of all deals with this company_id. Columns: Name, Amount, Stage, Owner, Expected Close. "Add deal" button that pre-fills the company.
- **Activity tab**: Unified activity timeline for ALL contacts at this company + direct company activities

## TASK 5: CSV IMPORT — /contacts/import

Multi-step import wizard for handling 10,000+ contacts:

### Step 1: Upload
- Drag-and-drop zone + "Browse files" button
- Accept .csv and .txt files, max 50MB
- Parse with PapaParse (already installed) in streaming mode for large files
- Show file name, row count, and column count after upload
- "Next" button

### Step 2: Column Mapping
- Left column: CSV headers from the file
- Right column: Dropdown to map to contact fields:
  - email (required — show error if not mapped)
  - first_name
  - last_name
  - phone
  - company_name (if mapped, will find-or-create companies)
  - lead_status
  - (any unmapped columns can be mapped to custom_fields.column_name)
- Auto-detect common headers: "Email", "email", "E-mail", "First Name", "first_name", "FirstName", etc.
- "Next" button (disabled until email is mapped)

### Step 3: Preview & Options
- Table showing first 10 rows with mapped data (show which field each column maps to)
- Highlight any rows with validation issues (invalid email format, missing required fields)
- Options:
  - "Skip duplicates" vs "Update existing contacts" (match by email) — radio buttons
  - "Add imported contacts to list" — optional dropdown to select or create a list
  - "Set lead status for all" — optional dropdown (default: keep from CSV or "new")
- Summary: "Ready to import X contacts (Y will be skipped due to invalid email)"
- "Start Import" button

### Step 4: Import Progress
- Progress bar showing "Importing... X of Y contacts"
- Process in batches of 500 contacts per insert
- For each batch:
  1. Validate emails (basic regex)
  2. If company_name column was mapped: upsert companies by name within workspace, get IDs
  3. If "skip duplicates": check existing emails in workspace, filter them out
  4. If "update existing": use upsert on (workspace_id, email)
  5. Bulk insert contacts
  6. If "add to list": bulk insert contact_list_members
  7. Create 'contact_created' activities for new contacts
- Use a Next.js API route `/api/contacts/import` that processes the batches server-side
- Client polls for progress or use server-sent events
- On complete: Show summary "Imported X contacts, Updated Y, Skipped Z (duplicates), W errors"
- "View contacts" button → navigates to /contacts

### Error handling
- If a batch fails, skip it and continue with next batch
- Collect all errors and show them at the end
- Allow downloading error rows as CSV for review

## IMPORTANT IMPLEMENTATION NOTES

1. All queries MUST filter by workspace_id from the WorkspaceProvider context
2. Use Server Components for initial page loads, Client Components for interactive parts
3. Every page needs a loading.tsx with a proper skeleton that matches the layout
4. Use the existing sidebar navigation — Contacts and Companies links should now work
5. Use lucide-react icons consistently
6. Use react-hot-toast for success/error notifications
7. Format dates with date-fns (formatDistanceToNow for relative, format for absolute)
8. Make all tables responsive — horizontal scroll on mobile if needed
9. Use URL search params for table state (page, search, filters) so back button works
10. When creating/updating contacts, always update the updated_at field
11. The existing `update_updated_at` trigger handles this automatically in the DB

## UI PATTERNS TO FOLLOW

- Slide-over panels for create/edit (not full page navigations)
- Colored badges for statuses: new=blue, contacted=yellow, qualified=purple, customer=green, churned=red
- Empty states: When no data, show an illustration-free message like "No contacts yet" with a CTA button
- Confirmation modals for destructive actions (delete)
- All forms validate on submit and show inline errors
- Tables use alternating row colors (white/slate-50) for readability

Build all of this now. Make sure `npm run build` passes with zero errors before committing.
