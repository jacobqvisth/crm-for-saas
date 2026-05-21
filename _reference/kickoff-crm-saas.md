# Start prompt — crm-saas

**Paste this into a fresh Cowork session with the `crm-saas` project selected (mounts `crm-for-saas/` git repo and `wrenchlane-crm/` planning folder).**

---

Starting a new crm-saas session. Project folders are already mounted so skip vault access.

Do this before anything else:

1. **Read `wrenchlane-crm/COWORK.md`** — current state, key commands, and next step from my last session.
2. **Read `crm-for-saas/cc-session-log.md`** — what Claude Code last built (most recent entry only; the log is append-only).
3. **Read `crm-for-saas/PROJECT-STATUS.md`** — persistent project status that Cowork maintains between sessions.
4. **Glance at `wrenchlane-crm/_prompts/`** to see if there's a staged CC prompt waiting to be fired, and `wrenchlane-crm/_inbox/` for anything I dropped in since the last session.

Then report back in 3 sentences:

- What CC last built and whether it shipped clean (build / lint / tsc / deploy)
- What's staged in `_prompts/` or flagged in COWORK.md as the next move
- Any drift between PROJECT-STATUS.md and cc-session-log.md, or any CI failures in the last few GitHub Actions runs (`gh run list --branch main --limit 5 --repo jacobqvisth/crm-for-saas`) that need a fix-forward

Then **wait for direction.** Don't start work until I confirm.

## Cowork's role here (reminder)

CC owns the full build-test-merge-deploy cycle on this project. Cowork does **not** merge, deploy, or run CI. Cowork's job is:

- Write CC prompts (store them in `wrenchlane-crm/_prompts/`)
- Update `PROJECT-STATUS.md` and `COWORK.md` based on what CC logs in `cc-session-log.md`
- Fix-forward if CI fails (open the issue, stage a fix prompt)
- Never modify `.env.local`, `crm-for-saas/src/middleware.ts`, or run DB migrations directly without an explicit ask

## Supabase context

Project ID: `wdgiwuhehqpkhpvdzzzl`. This is the crm-saas Supabase — **not** result-insurance (`ugibcnidxrhcxflqamxs`). Don't confuse them. 18 tables, all with RLS. Schema is in `crm-for-saas/CLAUDE.md` under "Database Schema" — read it there if you need details, don't ask me.

## Git / repo

Repo: `jacobqvisth/crm-for-saas`. Main branch: `main`. Every CC session branches off `origin/main`, pushes, opens a PR, merges itself. Vercel auto-deploys on push to main.

Go.
