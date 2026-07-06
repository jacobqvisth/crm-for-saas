# FEAT-7 · Enrichment coverage dashboard

- **Runner:** Sonnet · **Effort:** S · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
Enrichment (Apify Google Maps, find-phone/find-website) runs blind — no aggregate view of phone/email/website coverage by country/list. Data exists: `phone_searched_at`/`phone_search_outcome` stamps, `phone_enrichment_jobs`, `email_status`, the `phone_numbers` pool. `/dashboard/data-health` is the natural host page.

## PROMPT
Add an enrichment-coverage section to `/dashboard/data-health` (or a new card).

1. Add SQL (RPC or cached loader following `src/lib/ceo/cache.ts`) computing, per country and optionally per list: % contacts with a phone, % with a valid email (`email_status`), % companies with a website, and enrichment-attempt outcomes (`phone_search_outcome` distribution), plus counts of never-attempted.
2. Render as a coverage table + a few stat tiles (use the `dataviz` skill for palette/consistency).
3. Cache 5-min like the other dashboard loaders.

### Definition of done
- Coverage metrics visible per country (and list if easy), cached.
- `npm run lint` passes.

### Verify
Open the page and cross-check one country's phone-coverage % against a manual `COUNT(*) FILTER (WHERE phone IS NOT NULL)` query.
