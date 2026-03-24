# Phase 7: Contact Lists + Smart Lists

## Context
This is an existing Next.js 16 + Supabase CRM project. Phases 1-6 are complete (scaffolding, auth, contacts, companies, CSV import, deals pipeline, Gmail integration, email sequences, email tracking). The database already has `contact_lists` and `contact_list_members` tables. A placeholder page exists at `/lists`.

Read CLAUDE.md at the project root for architecture details, conventions, and route structure before starting.

## Existing Database Schema (do NOT run migrations)
```sql
CREATE TABLE contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_dynamic BOOLEAN DEFAULT false,
  filters JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE contact_list_members (
  list_id UUID REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
```

Also relevant — the contacts table:
```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  company_id UUID REFERENCES companies(id),
  status TEXT CHECK (status IN ('active','bounced','unsubscribed','archived')) DEFAULT 'active',
  lead_status TEXT CHECK (lead_status IN ('new','contacted','qualified','customer','churned')) DEFAULT 'new',
  custom_fields JSONB DEFAULT '{}',
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## What to Build

### 1. Lists Page (`/lists`)
Replace the existing placeholder at `src/app/(dashboard)/lists/page.tsx`.

**Table view:**
- Columns: Name, Type (Static/Dynamic badge), Description, Contact count, Created date
- "Create List" button → opens create modal
- Click row → navigates to `/lists/[id]`
- Quick actions: Duplicate, Delete
- Search by list name

### 2. Create List Modal/Form
- Name (required), Description (optional)
- Type toggle: Static or Dynamic
- For Static: just create the empty list, contacts added later
- For Dynamic: show the filter builder (see section 4)
- Save creates the list and navigates to its detail page

### 3. List Detail Page (`/lists/[id]`)
Create `src/app/(dashboard)/lists/[id]/page.tsx`.

**For Static Lists:**
- Header: List name (editable), description, type badge, contact count
- Action buttons: "Add Contacts", "Enroll in Sequence", "Export CSV", "Delete List"
- Contacts table: Name, Email, Company, Status, Lead Status, Added date
- Bulk actions: Remove from list, Change status
- "Add Contacts" button → opens a modal with:
  - Search tab: search contacts by name/email, select multiple, add to list
  - Import tab: "Import CSV" link to the existing CSV import flow (which should support adding to a list)
- Remove individual contacts from list (delete from contact_list_members)

**For Dynamic Lists:**
- Header: same as static but with "Edit Filters" button instead of "Add Contacts"
- Filter summary: shows current filter criteria in readable format
- Contacts table: same columns, but populated by running the filter query in real-time
- "Edit Filters" button → opens filter builder (see section 4)
- Contact count updates live as filters change
- No manual add/remove — membership is entirely filter-driven
- Action buttons: "Enroll in Sequence", "Export CSV", "Delete List"

### 4. Dynamic List Filter Builder
Build a filter builder UI component that constructs Supabase queries.

**Available filter fields:**
- `status` — dropdown: active, bounced, unsubscribed, archived
- `lead_status` — dropdown: new, contacted, qualified, customer, churned
- `company_id` — searchable company dropdown
- `created_at` — date range (before/after/between)
- `last_contacted_at` — date range, or "more than N days ago" / "within last N days"
- `email` — contains/equals text input
- `first_name` / `last_name` — contains text input
- `custom_fields` — key-value: field name + contains/equals + value

**Filter logic:**
- Each filter is a row with: Field dropdown, Operator dropdown, Value input, Remove button
- "Add Filter" button to add more rows
- All filters are AND-combined (for simplicity — OR can be added later)
- Store filters as JSONB in `contact_lists.filters`:
  ```json
  [
    {"field": "status", "operator": "equals", "value": "active"},
    {"field": "lead_status", "operator": "in", "value": ["new", "contacted"]},
    {"field": "last_contacted_at", "operator": "older_than_days", "value": 30},
    {"field": "company_id", "operator": "equals", "value": "uuid-here"}
  ]
  ```

**Query builder** — `src/lib/lists/filter-query.ts`:
- Function: `buildFilterQuery(supabase, workspaceId, filters)` → returns a Supabase query builder
- Translates each filter into `.eq()`, `.in()`, `.ilike()`, `.gte()`, `.lte()` etc.
- For `older_than_days`: calculate the date and use `.lte('last_contacted_at', date)`
- For `custom_fields`: use Supabase JSONB operators
- Always includes `.eq('workspace_id', workspaceId)`
- Returns the query so the caller can add `.select()`, `.range()`, etc.

### 5. Export to CSV
- Button on list detail page
- For static lists: query contact_list_members joined with contacts
- For dynamic lists: run the filter query
- Generate CSV with columns: Email, First Name, Last Name, Phone, Company, Status, Lead Status
- Download as `{list-name}-export.csv`
- Use client-side CSV generation (papaparse `unparse()` — already installed)

### 6. Enroll List in Sequence
- "Enroll in Sequence" button on list detail page
- Opens a modal: select a sequence (dropdown of active/draft sequences)
- On confirm: calls the enrollment API (`/api/sequences/enroll`) with all contact IDs from the list
- Shows results: "Enrolled X, Skipped Y (already enrolled/unsubscribed/bounced)"
- For dynamic lists: resolve the filter first to get contact IDs, then enroll

### 7. Enhanced CSV Import
Modify the existing CSV import wizard at `src/components/contacts/csv-import-wizard.tsx`:
- Add an optional "Add to List" step after import options:
  - Dropdown to select an existing static list, or "Create new list" option
  - If selected, after import completes, add all imported contacts to the chosen list

### 8. Component Structure
Create components in `src/components/lists/`:
- `list-table.tsx` — table of all lists
- `list-detail-header.tsx` — detail page header
- `list-contacts-table.tsx` — contacts in a list with bulk actions
- `filter-builder.tsx` — dynamic filter builder UI
- `filter-row.tsx` — single filter row
- `add-contacts-modal.tsx` — modal for adding contacts to static lists
- `enroll-list-modal.tsx` — modal for enrolling list in sequence
- `export-csv-button.tsx` — CSV export button

Create lib files:
- `src/lib/lists/filter-query.ts` — filter to Supabase query translator

### 9. Important Implementation Notes
- Dynamic lists resolve at query time — no materialized membership. Every time you view a dynamic list, the filter query runs fresh.
- Contact count for dynamic lists should be fetched with a count query, not by loading all contacts.
- Pagination: 50 contacts per page on list detail, same as the main contacts page.
- All Supabase queries must include workspace_id filter.
- Use toast notifications for all mutations.
- Follow existing UI patterns from contacts and sequences pages.
- Do NOT create new database tables or run migrations.
