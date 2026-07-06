# FEAT-8 · Per-mailbox deliverability feedback loop

- **Runner:** Opus 4.8 · **Effort:** M · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
A mailbox health check exists (`src/app/api/gmail/accounts/[id]/health-check` — SPF/DKIM/DNSBL + 30d bounce/reply rates) but it's on-demand, unpersisted, and doesn't influence sender rotation beyond the 8% bounce circuit breaker (`process-emails:90-168`). Building blocks: `getNextSender` rotation (`src/lib/gmail/sender-rotation.ts`), the orphan `gmail_accounts.health_score`, and the domain-health cron as a template. (Read FEAT-3 — same "score on a cron" pattern.) This also decides the fate of the warmup-orphan columns (CLEAN-1).

## PROMPT
1. **Daily cron** that runs the existing health-check per mailbox and persists a `health_score` (0-100) + component breakdown into `gmail_accounts.health_score` (resolves the orphan column) and a small history table for trends.
2. **Weight rotation by health:** update `getNextSender` to prefer healthier mailboxes (lower weight for degraded ones) in addition to the existing bounce breaker. Keep the hard breaker as a floor.
3. **Trend surface:** a small section (settings/email or a dashboard card) showing per-mailbox health over time and current standing.
4. **Warmup columns decision:** if you're not building warmup, drop `gmail_accounts.warmup_*`/`is_warmup` in the migration (CLEAN-1 item 4); keep `health_score`.

### Definition of done
- Daily cron writes health_score + history; rotation weights by it; a trend surface exists.
- `npm run lint`/`npm test` pass.

### Verify
Run the cron against the real mailboxes (read-only DNS/rate checks) and confirm scores populate; simulate a degraded mailbox and confirm `getNextSender` de-prioritizes it while the breaker still hard-stops at the bounce threshold.
