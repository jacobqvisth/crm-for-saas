# Phase 12a — Prospector (Contact Discovery)

## Goal

Build a **Prospector** page inside the CRM that lets Jacob search for contacts at relevant companies by country, job title, and industry using the Prospeo.io API. Selected contacts can be bulk-added to the CRM (contacts + companies tables) and optionally added to a list for immediate sequencing.

---

## What to Build

### 1. New Route: `/prospector`
File: `src/app/(dashboard)/prospector/page.tsx`

Full-width page with:
- Page header: "Prospector" with a subtitle "Find and add new contacts to your CRM"
- Two-column layout: filter panel (left, ~300px fixed) + results panel (right, fills remaining width)

### 2. Filter Panel (left side)

A `<ProspectorFilters />` client component with these inputs:

**Country** — multiselect dropdown
- Pre-populate with Nordic countries at the top of the list: Sweden, Norway, Denmark, Finland, Iceland
- Then the rest of the world alphabetically
- Allow selecting multiple
- Maps to Prospeo filter: `person_location.include[]`
- Default: empty (no country pre-selected)

**Job Title / Role** — free text input
- Placeholder: e.g. "Workshop owner, service manager, bilverkstad"
- Maps to Prospeo filter: `person_job_title.include[]` — split input by comma to allow multiple titles
- This is the most important field — users describe the role they're looking for

**Industry** — preset clickable tag pills (toggle on/off)
- Options: Automotive, Manufacturing, Transport & Logistics, Retail, Construction, Other
- Selecting multiple uses OR logic (any of these industries)
- Maps to Prospeo filter: `company_industry.include[]`
- Map "Automotive" → `"Automotive"`, "Manufacturing" → `"Manufacturing"`, "Transport & Logistics" → `"Transportation/Trucking/Railroad"`, "Retail" → `"Retail"`, "Construction" → `"Construction"`, "Other" → leave unset

**Company size** — 3-option toggle pill group (mutually exclusive or none selected)
- Small (1–10), Mid (11–200), Large (201+)
- Maps to Prospeo filter: `company_headcount_range.include[]`
- Map: Small → `["1-10"]`, Mid → `["11-50", "51-200"]`, Large → `["201-500", "501-1000", "1001-5000", "5001-10000"]`

**Search button** — full width, indigo, shows spinner while loading

**Reset button** — text button below, resets all filters

### 3. Results Panel (right side)

State machine: idle → loading → results | empty | error

**Idle state** (before first search):
- Centered illustration area with text: "Search for contacts using the filters on the left"

**Loading state**:
- Show 8 skeleton rows (animate-pulse)

**Results state**:
- Top bar:
  - Left: "X contacts found" count badge (from `pagination.total_count`)
  - Right: pagination controls (Prev / Page X of Y / Next)
- Bulk action bar — appears when 1 or more rows are selected, slides in from top:
  - "X selected" label
  - "Reveal & Add to CRM" button (indigo) — triggers the enrich + add flow
  - "Clear selection" text button
- Table with columns: ☐ | Name | Current Title | Company | Location | Action
  - Name: full_name from person object
  - Current Title: current_job_title
  - Company: company.name
  - Location: city + country (e.g. "Stockholm, Sweden")
  - Action: a small "+" icon button to add a single contact (same flow as bulk but for 1)
- Selecting the header checkbox selects/deselects all on current page

**Empty state**:
- Text: "No contacts found for these filters. Try broader criteria."

**Error state**:
- Red toast + inline message: "Search failed. Check your API key or try again."

### 4. "Reveal & Add to CRM" Modal

When the user clicks "Reveal & Add to CRM" (bulk action) or the "+" on a single row:

Show a modal:
- Title: "Add X contacts to CRM"
- Credit cost warning: "This will use X credits to reveal email addresses (1 credit per contact)."
- **List assignment** (optional):
  - Radio: "Don't add to a list" (default) | "Add to existing list" | "Create new list"
  - If "Add to existing list": dropdown of user's current lists (fetched from Supabase contact_lists)
  - If "Create new list": text input for new list name
- **Duplicate handling**: checkbox "Skip contacts already in CRM (by email)" — checked by default
- Confirm button: "Add contacts" — triggers the add flow
- Cancel button

Progress after confirm:
- Modal shows a progress bar / spinner with text "Enriching and adding contacts…"
- On success: "X contacts added" with a link to the list (if one was chosen) or to /contacts
- On partial success: "X added, Y skipped (already existed)"
- On error: show the error message

### 5. Backend API Routes

#### `POST /api/prospector/search`

Server-side route that proxies to Prospeo's search endpoint.

Request body (from client):
```typescript
{
  countries: string[],          // e.g. ["Sweden", "Norway"]
  jobTitles: string[],          // e.g. ["workshop owner", "service manager"]
  industries: string[],         // e.g. ["Automotive"]
  companySizes: string[],       // e.g. ["1-10", "11-50"]
  page: number                  // 1-indexed
}
```

Build Prospeo filters:
```typescript
const filters: Record<string, unknown> = {}

if (countries.length > 0) {
  filters.person_location = { include: countries }
}
if (jobTitles.length > 0) {
  filters.person_job_title = { include: jobTitles }
}
if (industries.length > 0) {
  filters.company_industry = { include: industries }
}
if (companySizes.length > 0) {
  filters.company_headcount_range = { include: companySizes }
}
```

Call Prospeo:
```typescript
const response = await fetch('https://api.prospeo.io/search-person', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-KEY': process.env.PROSPEO_API_KEY!,
  },
  body: JSON.stringify({ page, filters }),
})
```

Return the Prospeo response directly (results array + pagination).

Handle errors: if `error: true` in Prospeo response, return 400 with the error message.
If `INSUFFICIENT_CREDITS`, return 402 with message "Insufficient Prospeo credits."

#### `POST /api/prospector/add-contacts`

Server-side route that:
1. Takes array of `person_id` values + options (listId, newListName, skipDuplicates)
2. For each person_id, calls Prospeo Enrich endpoint to get their verified email
3. Upserts company record into `companies` table
4. Upserts contact record into `contacts` table
5. Optionally creates/adds to list in `contact_lists` + `contact_list_members`
6. Returns { added: number, skipped: number, errors: string[] }

Request body:
```typescript
{
  contacts: Array<{
    person_id: string,
    full_name: string,
    current_job_title: string,
    company_name: string,
    company_domain: string | null,
    city: string | null,
    country: string | null,
  }>,
  listId: string | null,         // existing list UUID or null
  newListName: string | null,    // create new list with this name, or null
  skipDuplicates: boolean,       // default true
  workspaceId: string,
}
```

**Enrich each contact** (call Prospeo's enrich endpoint):
```typescript
const enrichResponse = await fetch('https://api.prospeo.io/enrich-person', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-KEY': process.env.PROSPEO_API_KEY!,
  },
  body: JSON.stringify({
    only_verified_email: true,
    enrich_mobile: false,
    data: { person_id: contact.person_id }
  }),
})
```

**Parse name**: split `full_name` into `first_name` + `last_name` (split on first space, rest goes to last_name).

**Company upsert**: use `ON CONFLICT (workspace_id, domain)` if domain exists, otherwise just insert. Fields: name, domain (from company_domain), workspace_id.

**Contact upsert**: check if email already exists in `contacts` for this workspace_id. If skipDuplicates is true and email exists, count as skipped. Otherwise insert with: first_name, last_name, email, title (current_job_title), company_id (from company upsert), city, country, source='prospector', workspace_id.

If enrichment returns no verified email (status !== 'VERIFIED' or email is null), still add the contact without email — log it but don't fail the whole batch.

**List handling**:
- If newListName: insert into contact_lists → get list_id
- If listId provided: use it
- For each successfully added contact, insert into contact_list_members

**Rate limiting**: add a 100ms delay between Prospeo enrich calls to avoid hitting rate limits (Promise with setTimeout). Process sequentially, not parallel, to be safe.

### 6. Database Migration

Add a `source` column to the contacts table:

```sql
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT;
```

Create migration file: `supabase/migrations/[timestamp]_add_contacts_source.sql`

Content:
```sql
-- Add source column to contacts to track where contacts came from
-- Values: 'csv_import', 'manual', 'prospector', null (unknown)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT;
```

Run this migration. Then update TypeScript types (`npx supabase gen types typescript --project-id wdgiwuhehqpkhpvdzzzl > src/types/supabase.ts`).

### 7. Sidebar Navigation

In `src/components/sidebar.tsx`, add "Prospector" to the navItems array:

```typescript
import { Search } from "lucide-react"

// Add between Lists and Templates:
{ href: "/prospector", label: "Prospector", icon: Search },
```

### 8. Middleware Protection

In `src/middleware.ts` (or wherever route protection is configured), ensure `/prospector` is protected the same way as other routes. Check how the middleware currently works and make sure the new route is covered.

---

## Error Handling

- If `PROSPEO_API_KEY` is not set: return 500 with "Prospeo API key not configured. Add PROSPEO_API_KEY to your environment variables."
- If Prospeo returns `INVALID_FILTERS`: surface the `filter_error` field to the user
- If Prospeo returns `NO_RESULTS`: return empty results (not an error)
- If Prospeo returns `RATE_LIMITED` (429): return 429 with "Rate limit reached. Wait a moment and try again."
- If Prospeo returns `INSUFFICIENT_CREDITS` (400): return 402 with "Not enough Prospeo credits. Please add more credits at prospeo.io."
- Network errors: catch and return 500

---

## TypeScript Types

Define these in the API route files or a shared types file:

```typescript
// Prospeo API types
type ProspeoSearchResult = {
  person: {
    person_id: string
    first_name: string
    last_name: string
    full_name: string
    linkedin_url?: string
    current_job_title?: string
    headline?: string
    location?: {
      country?: string
      country_code?: string
      state?: string
      city?: string
    }
  }
  company: {
    company_id: string
    name: string
    website?: string
    domain?: string
    industry?: string
    employee_count?: number
    employee_range?: string
    location?: {
      country?: string
      city?: string
    }
  }
}

type ProspeoSearchResponse = {
  error: boolean
  error_code?: string
  filter_error?: string
  results?: ProspeoSearchResult[]
  pagination?: {
    current_page: number
    per_page: number
    total_page: number
    total_count: number
  }
}
```

---

## Environment Variables

Add to `.env.local`:
```
PROSPEO_API_KEY=your_key_here
```

Add to Vercel project environment variables with the same name.

**Important**: Never expose this key to the client. All Prospeo calls must go through the server-side API routes.

---

## Before Finishing

1. `npm run build` — must pass with no errors
2. `npm run lint` — must pass
3. The page should render without errors even if `PROSPEO_API_KEY` is not set (show a friendly "API key not configured" message instead of crashing)
4. Test manually: open `/prospector`, select Sweden + Automotive, click Search — should return results or a clear error

---

## PR Description

Title: `feat: add Prospector page for contact discovery via Prospeo.io`

Description should explain:
- What was built (discovery search + bulk add to CRM)
- The two-call pattern: search returns person_id, enrich reveals email (saves credits)
- The new `source` column on contacts
- What Jacob needs to do: add `PROSPEO_API_KEY` to `.env.local` and Vercel env vars, sign up at prospeo.io to get an API key
