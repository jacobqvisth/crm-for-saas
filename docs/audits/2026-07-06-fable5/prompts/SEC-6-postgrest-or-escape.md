# SEC-6 · Escape PostgREST `.or()` search input

- **Runner:** Sonnet · **Effort:** S · **Severity:** LOW-MED · **Repo:** `~/crm-for-saas`

## Context
~13 sites interpolate raw user search text into PostgREST `.or("email.ilike.%${search}%,domain.ilike.%${search}%")` filters. A `,`, `)`, `*`, or PostgREST operator in the term injects extra OR conditions. Impact is bounded (anon/cookie client → RLS + ANDed `workspace_id` confines results; single-tenant), so this is correctness/robustness, not exfiltration — but it's a real injection pattern and cheap to close. Only `src/lib/ceo/internal-test/loader.ts` (~299) currently sanitizes.

Known sites: `src/app/api/settings/compliance/route.ts` (~44), `src/app/api/discovery/{promote,skip,verify-email,shops}/route.ts`, `src/lib/contacts-filter.ts` (~108), `src/lib/companies-filter.ts` (~52), `src/lib/lists/filter-query.ts`, plus a few client components building `.or()` strings.

## PROMPT
1. Add `src/lib/supabase/escape.ts` exporting `escapePostgrestLike(term: string): string` that removes/escapes the PostgREST metacharacters (`%`, `,`, `(`, `)`, `\`, and leading/trailing whitespace) so an interpolated `ilike` pattern can't break out of its column filter. Model it on the existing sanitization in `lib/ceo/internal-test/loader.ts:299` but make it the shared canonical version and update that file to use it too.
2. Grep the repo for `.or(` and `ilike.%${` / template-string `.or()` construction; wrap every interpolated user-search value with `escapePostgrestLike(...)`.
3. Add a unit test covering `a,b`, `x)`, `50%`, `foo*` → confirm the escaped output can't introduce a second filter clause.

### Definition of done
- All raw-interpolation `.or()` search sites use the helper.
- Search still returns expected results for normal terms.
- `npm run lint` passes; new test passes.

### Verify
Search a contacts/companies list for a term containing `,` and `%` and confirm results are sensible (treated as literal), not an error or a widened result set.
