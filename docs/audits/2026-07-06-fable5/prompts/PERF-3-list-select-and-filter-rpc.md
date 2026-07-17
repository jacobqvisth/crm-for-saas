# PERF-3 · List pages: kill `select('*')`, add filter-option RPCs

- **Runner:** Opus 4.8 (design the RPCs) then Sonnet (apply) · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
The two most-used pages fetch whole tables from the browser, and — because PostgREST silently caps un-paginated selects at 1000 rows — several results are also **silently wrong** (filter dropdowns miss data beyond 1000 of 16k–27k rows).

- **Contact detail** `src/components/contacts/contact-detail-client.tsx:233-238`: `from('companies').select('*').order('name')` for a dropdown (27k wide rows ≈ 1.2 MB, capped at 1000).
- **Contacts list** `src/components/contacts/contacts-page-client.tsx:501,517,537,551-575`: all-companies `select('*')`; distinct countries/sources capped; tags loop pages the whole 16k table client-side per mount.
- **Companies list** `src/components/companies/companies-page-client.tsx:390-472`: countries/sources capped; industries/tags page the full 27k table (~27 requests each) per mount.

## PROMPT
Eliminate whole-table fetches on the companies & contacts pages.

1. **Company pickers → async search combobox.** Replace the "load all companies" dropdowns with a debounced search that queries `from('companies').select('id,name').ilike('name', escaped+'%').limit(20)`. Reuse `escapePostgrestLike` from SEC-6 if present. Applies to contact-detail and any other all-companies dropdown.
2. **Filter options → RPC.** Add SQL functions returning `DISTINCT` filter values (countries, sources, industries, tags) per workspace — e.g. `get_contact_filter_options(p_workspace_id uuid)` and `get_company_filter_options(...)` returning arrays or a single JSON row. Call them once per page mount instead of paging whole tables. (For tags stored as arrays, use `unnest` + `DISTINCT`.) Make them `SECURITY INVOKER` and grant only what's needed (respect SEC-5).
3. **Narrow every remaining `select('*')`** on these pages to the columns actually rendered.
4. Optionally cache the filter-options result client-side (localStorage + short TTL) to avoid refetching on every mount.

### Definition of done
- No `select('*')` over full companies/contacts tables from the browser on these pages.
- Filter dropdowns show the complete distinct set (verify against a `SELECT COUNT(DISTINCT ...)`), not a truncated 1000-row sample.
- Company pickers work via search, not a giant preloaded list.
- `npm run lint` passes.

### Verify
Load the contacts and companies list pages, open each filter dropdown, and confirm options are complete and the page issues a handful of requests (not ~50). Network panel: no multi-MB companies payload. Drive with the `verify` skill.
