# FEAT-15 · Finish the `/dashboard` unified overview

- **Runner:** Sonnet · **Effort:** S–M · **Priority:** P3 · **Repo:** `~/crm-for-saas`

## Context
The `/dashboard` index is a stub that redirects to app-usage; the "unified overview (PR2)" was never built. All the `/dashboard/*` loaders exist and are cached — compose from them.

## PROMPT
1. Build a real `/dashboard` overview page composing the top KPIs from existing cached loaders: outbound (sends/opens/replies last 7/30d), pipeline/funnel (if FEAT-10 lands; else lifecycle counts), app-usage headline (active workshops, diagnostics), reviews snapshot, domain-health status.
2. Reuse the existing `unstable_cache` loaders (`src/lib/ceo/*`) — do NOT add new heavy queries; just assemble cards that link to the detailed pages.
3. Respect the country filter (`?country=SE`) where `COUNTRY_FILTER_SECTIONS` applies.
4. Remove the redirect once the page is real.

### Definition of done
- `/dashboard` renders a composed overview from existing loaders, each card linking to its detail page.
- No new uncached heavy queries.
- `npm run lint` passes.

### Verify
Open `/dashboard` → KPIs match the underlying detail pages; cards link correctly; country filter works. Drive with the `verify` skill.
