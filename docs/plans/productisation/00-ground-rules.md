# 00. Ground rules

**Every session working on this programme must read this file first and obey it.**
These are the rules that keep a live business running while the system underneath it
is rebuilt. Breaking one of them is how a customer's outbound stops on a Tuesday.

---

## R1. Wrenchlane is a live business, not a staging environment

`crm-for-saas` is running real campaigns for a real company right now. Phases 01 to 07
must be **behaviour preserving**. If a Wrenchlane user could notice your change, you have
gone outside the phase.

The test for every PR in phases 01 to 07: *if this deployed to Wrenchlane in the next ten
minutes with no announcement, would anything be different?* The answer must be no.

## R2. New behaviour ships behind a flag that defaults to the current behaviour

Never introduce a flag that defaults to off for Wrenchlane before phase 08. Every feature
Wrenchlane uses today defaults to enabled, forever, unless Jacob says otherwise. New
tenants get a config that switches things off; Wrenchlane's config is the baseline.

**The second sentence is now actionable and has not been acted on.** Since 2026-08-31 the
control plane holds rows for all three tenants, so "a config that switches things off" is a
set of overrides made in the console rather than a future idea. Nobody has decided which of
the twenty features Animech and Spennare should get, so today they would inherit all
nineteen that default on — including the fault-code dashboards and the car-forum answering.
See `11-tenant-bring-up.md` section D. Turning them off per tenant honours this rule;
flipping registry defaults breaks it.

## R3. Migrations are additive and backward compatible. Always.

Tenants can be on different code versions (see release channels in the README). A migration
that runs on a database whose app is one release behind must not break it.

**Expand and contract, over two releases:**

- Release N: add the new column, table or index. Write to both old and new if you must.
  Never drop, never rename, never tighten a constraint.
- Release N+1, only once every tenant is confirmed on release N: remove the old thing.

Concretely, this is banned in a single release:

- `DROP COLUMN`, `DROP TABLE`, `ALTER COLUMN ... TYPE`, `RENAME`
- Adding `NOT NULL` without a default to a table that has rows
- Narrowing a `CHECK` constraint
- Removing an enum value

A rename is always two releases: add the new column, backfill, dual-write, ship the code
that reads the new one, then drop the old one in a later release.

## R4. Every migration runs on every tenant database, from one script, never by hand

There is no world where three schemas are kept in step manually. After phase 01 there is a
single honest migration history and a script that applies it to every tenant listed in the
control plane. If you write a migration and only apply it to one database, you have created
a drift bug that will surface weeks later as a missing column in production.

## R5. Never copy `.env.local` between tenants

Every external credential in this system comes from environment variables. Copying an env
file makes one customer's deployment authenticate **as Wrenchlane** against Stripe, GA4,
Google Ads, Search Console, PostHog, App Store Connect and the S3 export. Within an hour
the sync crons would fill that customer's database with Wrenchlane's revenue and users.

Start every tenant from `.env.local.example` and fill it in deliberately. Generate a fresh
`ENCRYPTION_KEY` and `CRON_SECRET` per tenant: the existing ones decrypt Wrenchlane's mail
tokens.

## R6. Never create a `pg_cron` job with a hardcoded URL

The nine existing jobs in `supabase/ceo-cron*.sql` have `https://crm-for-saas.vercel.app`
written into the SQL. Restoring those files into another tenant's database makes that
database hammer Wrenchlane's production app nine times an hour, from somewhere nobody is
watching. Any tenant that needs scheduled database jobs gets them templated with its own URL.

## R7. No credential may cross a tenant boundary

- The control plane holds **no** tenant service-role keys and **no** customer data.
- No tenant holds another tenant's keys.
- Tenants pull their own config with a token scoped to themselves.

If a design requires the admin console to read a tenant's database directly, the design is
wrong. Go back and make the tenant push what the console needs.

## R8. One phase, one branch, one PR, merged before the next starts

Do not run two phases in parallel. They touch the same files and the merge conflicts will
cost more than the parallelism saved. If you want parallel sessions, use separate worktrees
under `.claude/worktrees/` and only for work that does not overlap.

Branch naming: `feature/prod-NN-short-name`, matching the phase number.

## R9. Green before merge, every time

```
npm run build
npm run lint
npx tsc --noEmit
npm run test:e2e:smoke
```

All four pass, or the PR does not merge. Known noise that is **not** a regression:

- Vercel **preview** builds always fail on a prerender of `/calls/feedback`. The GitHub
  Actions "Build & Lint" job is the gate, not the preview deploy.
- The Migration Safety check goes red on every migration PR unless the schema is exposed
  in the Supabase dashboard. That is a dashboard setting, not drift.

## R10. Write down what you did

Append to `cc-session-log.md`: phase number, date, PR, branch, what was built, what was
skipped, anything surprising. Update this directory's `README.md` phase table when a phase
is done. The next session has no memory of yours.

## R11. Stop and ask when the ground shifts

Ask Jacob rather than guessing when:

- A phase turns out to need a change that Wrenchlane users would notice.
- The Graph spike in phase 07 fails one of its four checks.
- A migration cannot be made additive.
- Standing up a tenant is taking days rather than hours, which means phases 02 to 05 are
  incomplete and pushing on will bake the problem in.

Everything smaller: decide, note it in the commit message, keep going.

---

## Inherited quirks, so nobody rediscovers them at cost

- **Paged reads need a unique tiebreaker.** A non-unique `.order()` silently duplicated and
  skipped rows and made totals about 18 percent wrong. Fixed, but do not reintroduce it.
- **Never append a query string to an OAuth `redirectTo`.** Supabase matches it against an
  exact allow-list; a stray parameter strands real users on localhost. Applies to the Entra
  flow too, on every tenant.
- **Unverified addresses silently pause enrollments.** Verify before starting any campaign
  or contacts sit inert with no visible error. 53 sat that way once.
- **Worktree builds need `.env.local` symlinked** into the worktree, or the build fails
  during prerender. Remove the symlink afterwards.
- **`CLAUDE.md` is stale.** It documents `/deals` as a live route, but the Deals feature was
  deleted in PR #357 and there are zero code references to `deals`, `pipelines` or
  `deal_contacts` left. It also still lists Inngest in the stack line. Fix both rather than
  propagating them to three customers.
