# FEAT-5 · A/B stats completion (significance + dashboard + auto-promote)

- **Runner:** Opus 4.8 · **Effort:** S–M · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
Per-variant A/B comparison already exists **client-side per sequence**: `src/components/sequences/sequence-analytics-tab.tsx` has a per-variant table with a ≥20-send "Leader" badge and a Promote-winner button (weight 5/1). What's missing: statistical significance, roll-up in the campaigns dashboard, and automation. Plumbing exists: `sequence_step_variants` (`sends_count`, `weight`), `email_queue.variant_id`.

## PROMPT
1. **Server-side variant stats RPC:** add `get_variant_stats(p_sequence_id uuid)` (or extend the existing conversions RPC) returning per-variant sends/opens/replies/positive-replies by joining `email_queue.variant_id` → events. Move the client-side aggregation onto this so it's consistent and cheap.
2. **Significance:** compute a two-proportion z-test (or a simple Bayesian probability-to-beat) on reply/positive-reply rate between variants; show "not enough data" until a min sample (keep the ≥20 gate). Display the winner only when significant.
3. **Dashboard rollup:** add per-variant rows (open/click/reply) to `/dashboard/email-campaigns` (which currently has none).
4. **Optional auto-promote cron:** when a variant is significant AND past min-sample, bump its weight (or promote) — behind a per-sequence opt-in flag. Log the action.

### Definition of done
- Variant stats come from an RPC; significance shown; dashboard has per-variant rows; optional auto-promote gated by a flag.
- `npm run lint`/`npm test` pass.

### Verify
Unit-test the significance function against known inputs (clear winner vs a tie → correct verdict). Open a sequence with variant data and confirm the significance display; check the dashboard per-variant rows match the sequence tab.
