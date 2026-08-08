# Runnable prompts — how to use

Each file here is a **self-contained task** for a fresh Claude Code session in `~/crm-for-saas`. Every prompt states its own goal, the files it touches, the context it needs, acceptance criteria, and a verification step — so you don't need to load the rest of this audit to run one.

## How to run one
1. Open a new session: `cd ~/crm-for-saas` (start a worktree if the prompt changes code).
2. Pick the model in the prompt's **Runner** header (Opus 4.8 for correctness-critical / design; Sonnet for mechanical).
3. Paste the prompt body (everything under `## PROMPT`). The agent should follow the Definition of Done and run the verification before opening a PR.
4. One prompt = one PR. They're ordered so P0 → P1 → P2 → P3 is a safe sequence, but most are independent.

## Conventions baked into every prompt
- Work in a git worktree; open a **draft PR**; never push to main.
- DB/DDL changes: apply via a new file in `supabase/migrations/` (timestamped) AND note that prod apply goes through the Management API / psql per the team's process — do **not** self-apply to prod.
- After code changes run `npm run lint` and (once REL-1 lands) `npm test`; for behavior changes drive the flow per the `verify` skill.
- Preserve existing behavior unless the prompt says to change it.

## Dependency notes
- **REL-1** (vitest in CI) should land early — many later prompts add tests that only pay off once CI runs them.
- **ARCH-1** (auth helpers) makes SEC/ARCH route edits smaller; if you're doing many route prompts, do ARCH-1 first.
- **FEAT-3** and **FEAT-8** both add a "score on a cron" — read both before starting either.
- **CLEAN-1** warmup/deals/health_score drops are gated on the FEAT-8/FEAT-10/FEAT-3 decisions — don't drop those columns until you've decided against the feature.

## Index
See `../BACKLOG.md` for the full table with severity/effort/runner. Files are named `<ID>-<slug>.md`.
