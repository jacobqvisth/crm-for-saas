# FEAT-10 · Pipeline / funnel view

- **Runner:** Opus 4.8 · **Effort:** M · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
There's no deal or funnel surface anywhere, yet `lifecycle_stage` (written by 3 code paths), `lead_status`, interested replies, and an activities timeline all exist. Dead `deals`/`pipelines`/`deal_contacts` tables exist (revivable from git history). **Recommendation: build a lightweight lifecycle/lead_status funnel over companies rather than reviving the deals tables** — less machinery, uses live data.

## PROMPT
Build a funnel/pipeline view (prefer the lightweight lifecycle approach).

1. **Funnel counts endpoint/RPC:** count companies (and/or contacts) by `lifecycle_stage` and `lead_status` per workspace, with movement over a date range if easy. Respect the status taxonomy in project memory (orthogonal axes).
2. **View:** a page (or a `/dashboard` section) showing the funnel (stage → count → conversion %) and a simple kanban/board of companies by stage where reps can move a company between stages (writing `lifecycle_stage`/`lead_status`).
3. **Decide the deals tables:** if this lightweight view is enough, mark `deals`/`pipelines`/`deal_contacts` for drop (CLEAN-1 item 3). If a true deal object is wanted later, note the revival path from git history instead.
4. Link funnel stages to filtered company lists.

### Definition of done
- A funnel view with real counts + a stage board that persists moves.
- A recommendation in the PR on deals-table drop vs revive.
- `npm run lint`/`npm test` pass.

### Verify
Cross-check one stage's count against a `SELECT count(*) ... GROUP BY lifecycle_stage` query. Move a company between stages and confirm it persists and the funnel updates.
