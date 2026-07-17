# FEAT-11 · Contact duplicate detection

- **Runner:** Opus 4.8 · **Effort:** M · **Priority:** P3 · **Repo:** `~/crm-for-saas`

## Context
The company merge flow is complete (`company_merge_candidates` table + hourly trigram cron + side-by-side merge/dismiss UI at `/companies/duplicates`). Contacts have no equivalent, yet one person shows up under multiple gmail user_ids/emails (the rep-ownership pain, per project memory — there's already a canonical-identity mapping in the reps lib). **Clone the company-merge pattern for contacts.**

## PROMPT
1. **`contact_merge_candidates` table + cron** mirroring `company_merge_candidates`: detect likely-same contacts by normalized email, name+company, and the reps canonical-identity mapping (same person across gmail user_ids). Store pairs with a similarity score and status.
2. **Merge UI** at `/contacts/duplicates` cloning `/companies/duplicates` (side-by-side cards, merge/dismiss).
3. **Merge function** (RPC, `SECURITY DEFINER` but revoke anon per SEC-5): reassign activities, enrollments, email_queue, tasks, phone_numbers to the kept contact; keep the richer field values; delete/tombstone the dropped one. Must be transactional.
4. Reuse the reps canonical-identity logic so merges respect the existing person-mapping.

### Definition of done
- Candidates generated on a cron; a merge UI; an atomic merge that re-parents all child rows.
- `npm run lint`/`npm test` pass.

### Verify
Seed two obvious duplicate contacts in a test workspace, run the cron, merge them in the UI, and confirm all activities/enrollments moved to the survivor with no orphans. Unit-test the merge RPC re-parenting.
