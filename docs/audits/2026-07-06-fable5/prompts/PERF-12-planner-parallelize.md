# PERF-12 · Call planner: parallelize independent stages

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/calls/planner/route.ts:92-147` runs 5 independent stages sequentially before the parallel count block: `listReps` → exclusions → bouncedSubs → full candidate pool page-loop → `loadNeverCallSets`. These don't depend on each other. `dashboard_subscriptions` query (~123-126) is unlimited (fine at 301 rows today, but add a note).

## PROMPT
1. Wrap the independent pre-stages in `Promise.all([...])` so reps/exclusions/bouncedSubs/candidate-pool/never-call-sets load concurrently. Keep any genuine data dependencies sequential.
2. Add a defensive `.limit()` (or pagination) to the `dashboard_subscriptions` query with a comment that it's currently under the 1000 cap but should paginate if it grows.
3. Don't change the ranking/segment logic — this is purely making the waterfall concurrent. (Long-term, FEAT-3 moves scoring into SQL; leave a pointer.)

### Definition of done
- Planner latency drops (independent stages overlap); output identical.
- `npm run lint` passes.

### Verify
Load the call planner and confirm the same ranked list appears; time the endpoint before/after.
