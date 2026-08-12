# FEAT-3 · PQL / health scoring feeding the call planner

- **Runner:** Opus 4.8 · **Effort:** M · **Priority:** P1 · **Repo:** `~/crm-for-saas`

## Context
Freemium users showing product usage are the hottest calls, but the call planner ranks by playbook segments only. All the signal exists: `companies.health_score` (an **orphan column with a display slot** at `src/components/companies/detail/signals.tsx:65`, never computed), `usage_events`, `subscriptions`, `diagnostics_total`/`diagnostics_last_30d`, `lifecycle_stage='freemium'`, and an hourly `propagate-to-crm` cron to hang the computation on. Planner ranking is in `/api/calls/planner`. (Read FEAT-8 too — it also computes a score on a cron; share the pattern.)

## PROMPT
Compute a product-qualified-lead health score and let reps sort by it.

1. Define a transparent scoring formula (document it) combining: recent usage (`usage_events`/diagnostics_last_30d), lifecycle_stage (freemium with usage = hot), subscription status/plan, recency of activity, and negative signals (churned/no usage). Keep it a simple weighted sum to start — explainable beats clever.
2. Compute it in the hourly `propagate-to-crm` cron (or a new small cron) and write to `companies.health_score` (resolves the orphan column). Store a short `health_score_reasons` JSON if easy, for the display tooltip.
3. Add sort + filter by `health_score` in `/api/calls/planner` and the call-list/list builder; optionally add a "Hot PQLs" playbook segment.
4. The display slot at `signals.tsx:65` should now show a real value.

### Definition of done
- `health_score` populated on a cron; planner can sort/filter by it; a "hot" segment exists.
- Formula documented in the PR.
- `npm run lint`/`npm test` pass.

### Verify
Run the scoring cron against a test/prod-read workspace; spot-check that a freemium workshop with recent diagnostics scores higher than a dormant free one. Confirm the planner "Hot PQLs" list looks sane.
