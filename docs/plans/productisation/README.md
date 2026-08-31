# Productisation: one CRM, many customers

**Status:** planned, not started. **Owner:** Jacob. **Written:** 2026-08-29.

This directory is the executable spec for turning `crm-for-saas` from Wrenchlane's
internal CRM into one configurable product serving several customers.

Read `00-ground-rules.md` before touching anything. Then run the phases in order.
One phase per Claude Code session, one branch, one PR.

## The customers

| Tenant | Business | Motion | Mail |
|---|---|---|---|
| **Wrenchlane** | Self-serve diagnostics for car workshops | High-volume outbound + PLG | Google Workspace |
| **Animech** | 3D configurators + CPQ (Volkswagen, SKF, Cytiva, Fjällräven), ~40 people, Uppsala | Enterprise consultative, buying committee | Microsoft 365 |
| **Spennare** | Portable exhibition systems, sold via resellers in 50+ countries | Reseller / dealer network, international | Microsoft (confirm) |

Three motions that overlap in the middle and diverge at the edges. That is what a
configurable product handles well and a fork handles badly.

## The architecture

**One codebase. One deployment and one database per customer.**

```
                          +-- vercel: wrenchlane --> supabase: wrenchlane  (Google mail)
crm-for-saas (one main) --+-- vercel: animech    --> supabase: animech     (Microsoft mail)
                          +-- vercel: spennare   --> supabase: spennare    (Microsoft mail)
                          |
                          +-- vercel: control-plane --> supabase: control-plane
                                  (feature flags only, ZERO customer data)
```

A fix merged once reaches everyone on their next deploy. No customer's rows ever sit
in another customer's database.

### Why not a shared database with a workspace per customer

It is the cheapest to operate and the app is already shaped for it (every table has
`workspace_id`, 123 RLS policies, `get_user_workspace_ids()`). It is rejected **for now**
because:

1. The multi-tenant isolation has known leaks and the fix is an unmerged draft.
2. Wrenchlane's own commercial data would share a database with paying clients.
3. Animech is a SOFF member working in aerospace and defence and will have a security review.
4. One bad migration becomes an incident for every customer at once.
5. It is the only option you cannot reverse.

Revisit at roughly ten customers, and never before the isolation leaks are closed.

### Why not a fork per customer

Triple maintenance forever, for one person, and fixes stop propagating as the forks drift.

## The super-admin console

Jacob needs one page to control which customer sees which features. The trap is that the
obvious implementation, a console holding every tenant's service-role key, creates a single
credential that can read every customer's database. That is not acceptable.

**Instead: tenants pull, the console never reaches in.**

- A separate small **control plane** (its own Supabase project + its own Vercel deployment)
  stores tenants, a feature registry, and per-tenant flags. It stores **no customer data and
  no tenant service-role keys**.
- Each tenant app **pulls its own config** from the control plane using a token scoped to
  that tenant alone. A tenant can only ever read its own row.
- Blast radius if the control plane is compromised: someone can toggle features. They cannot
  read a single contact.

Config resolution in every tenant app is three layers deep so it can never hard-fail:

1. Live pull from the control plane (short TTL)
2. Last good value cached in the tenant's own database
3. The compiled default in `src/config/tenants/<slug>.ts`

### Features vs updates: two different mechanisms

Jacob asked to control both which features a customer sees and which updates they get.
Those are separate and must not be conflated.

- **Which features are visible** is a flag, toggled in the console, effective within the
  cache TTL, no deploy.
- **Which code a customer runs** is a git branch. `main` is where work lands; `stable` is
  what customers run. Each Vercel project tracks a branch. Promotion is
  `git push origin main:stable` after verification. The console *displays* each tenant's
  channel and current commit; it does not pretend to move code from a web page.

Because tenants can be on different code versions, **every migration must be additive and
backward compatible**. See the expand/contract rule in `00-ground-rules.md`. This is the
single easiest way to break a customer and it is entirely avoidable.

## Phases

Run in order. Do not start a phase before the previous one is merged.

| # | Phase | Status | Visible change for Wrenchlane |
|---|---|---|---|
| [01](01-migration-baseline.md) | Squash the desynced migration history into one honest baseline | **Done** 2026-08-29 (#746) | None |
| [02](02-tenant-config.md) | Typed tenant config module and resolver | **Done** 2026-08-29 (#749) | None |
| [03](03-feature-registry.md) | Feature registry, and gate nav + routes + crons | **Done** 2026-08-30 (#751) | None (all flags default on) |
| [04](04-control-plane.md) | Control-plane database and super-admin console | **Done** 2026-08-30 | None |
| [05](05-config-pull.md) | Tenants pull their config, with cache and fallback | **Done** 2026-08-30 | None |
| [06](06-mail-provider-interface.md) | Move Gmail behind a `MailProvider` interface | **Partial** 2026-08-30 | None |
| [07](07-microsoft-graph.md) | Add the Microsoft Graph provider | Not started | None |
| [08](08-tenant-animech.md) | Stand up Animech as tenant two | Not started — **08a needs no customer** | None |
| [09](09-tenant-spennare.md) | Stand up Spennare as tenant three | Not started | None |
| [10](10-per-tenant-features.md) | Deal pipeline, discovery sources, dealer hierarchy | **D+E partial** 2026-08-30 | Additive |
| [11](11-tenant-bring-up.md) | Branding, env manifest, tenant bootstrap, per-tenant defaults | **Not started — blocks 08** | None |

Phase 01's production reconcile **has been run** (2026-08-30). Wrenchlane's migration
history is a single `00000000000000 baseline` row, `scripts/migrate-tenants.mjs` reports
"nothing to apply", and the schema is unchanged.

The control plane lives at Supabase project `ktkuwmuhhrbwzysuxfzi`
(`jacobs-crm-control`) and is **deployed** at
https://jacobs-crm-control.vercel.app. How to operate, redeploy and wire tenants to it
is in `CONTROL-PLANE-RUNBOOK.md`. Google sign-in is enabled and it has been signed into;
the OAuth client is its own, deliberately not the CRM's, because R7 forbids a credential
crossing a tenant boundary.

All three tenants are in it: `wrenchlane` active, `animech` and `spennare` provisioning.
Each tenant also reports aggregate counts to `/api/heartbeat` on a daily cron — **reported
inward, never read out**, because reading would require the control plane to hold a
service-role key per tenant, which is one credential that reads every customer's CRM.

**No tenant is wired to it yet**, so every tenant runs on compiled defaults. That is a
supported state. Note that wiring Wrenchlane is **no longer a no-op**: `linkedin_steps` was
switched on for it in the console on 2026-08-31, so wiring would turn that feature on in
production. Re-run the runbook's pre-flight comparison before doing it.

**Phase 06 is deliberately half-landed.** The interface, the Google implementation and
the whole schema half are done and verified. The seven live Gmail API call sites (the send
engine, `check-replies`, `mailbox-sync`, the inbox routes and the OAuth connect) still call
Gmail directly through `lib/mail/google/client`, and are unchanged.

That was a judgment call, not an oversight. Rewiring them means changing Wrenchlane's live
outbound and inbox-sync paths, and the brief's own "done when" requires proving it by
sending a real sequence email and seeing the reply detected in production — which cannot be
done from an agent session. Swapping them blind and merging would have put a live business's
email on an unverified path. Do that swap in a session where a real send can be watched.

Phases 01 to 07 change nothing that any Wrenchlane user can see. That is deliberate, and it
means the first stretch of work produces nothing demonstrable. Say so up front rather than
discovering it halfway.

## Where this stopped, and why

Phases 01 to 06 are merged. **07, 08, 09 and most of 10 are blocked on things that cannot be
obtained from a code session**, not on effort:

- **07 (Microsoft Graph)** opens with a one-day spike against a throwaway Microsoft 365
  mailbox, and needs an Entra app registration with admin consent in the customer's own
  tenant. No mailbox, no tenant, no consent.

  Everything that does not need those now exists: `GraphProvider` is written and registered,
  and `scripts/graph-spike.mjs` runs all four spike checks against the real provider class
  and prints what it observed. **The implementation has never touched a real tenant**, so
  nothing about it should be believed until that script has been run. It is written to fail
  loudly and to say which of the four checks failed, because a failure there is a design
  input for the phase rather than a bug to work around (R11).

  **The consent conversation can start now.** `ENTRA-APP-SETUP.md` is written to be sent to
  a customer's IT more or less as it stands: what to register, the two permissions, the
  Application Access Policy that scopes the app to named mailboxes rather than the whole
  tenant, and the `Test-ApplicationAccessPolicy` output to ask back as evidence. Both new
  tenants are on Microsoft 365, so it blocks both.
- **08 / 09 (Animech, Spennare)** are **half blocked, not wholly.** The brief now splits
  them: **08a** (Supabase project, Vercel project, baseline migration, env, tenant config,
  feature flags) needs nothing from the customer and produces a live URL with a live
  database. **08b** (mail, Microsoft sign-in) needs their Entra tenant and a sending domain.
  The only thing standing between today and 08a is phase 11 and **$10/month** for the
  Supabase project — see the who-does-what table in the phase 08 brief.
- **10 A-C** are explicitly gated on customer knowledge by their own brief: "Get Animech's
  actual stages, deal sizes and typical cycle length before designing the forecast. Guessing
  produces a pipeline nobody uses." and "Scope it with Spennare rather than from first
  principles."

10 D and E were unblocked and are done: the contract-step register exists, and `CLAUDE.md`
no longer documents a deleted feature, a dependency that is not installed, or an RLS claim
that was wrong by 83 tables.

## What is NOT blocked, in the order it should be done

The list above is what needs someone else. This is what needs us, and none of it is waiting
on a customer.

1. **[Phase 11](11-tenant-bring-up.md) — the parts no phase covers.** Found on 2026-08-31 by
   asking what would happen if Animech signed in tomorrow. The sidebar hardcodes Wrenchlane's
   wordmark; 43 of the 67 environment variables the code reads are undocumented; a fresh
   tenant database has 101 tables and no workspace; 19 of 20 features default to ON, so a
   3D-configurator company would inherit fault-code dashboards and Reddit car-forum
   answering; and `/login` offers one hardcoded Google button, when both new tenants are on
   Microsoft. **This is the real blocker on 08**, and none of it needs Animech.
2. **Close [issue #747](https://github.com/jacobqvisth/crm-for-saas/issues/747)** —
   `discovered_shops` has RLS disabled and holds ~42k scraped contacts. Five discovery routes
   use the user-session client, so a policy has to be written and verified against a real
   login rather than switched on blind. The brief says close it before a second tenant exists.
3. **Phase 06 part 2** — the seven live Gmail call sites. Not blocked on a customer, blocked
   on supervision: it changes live outbound and inbox-sync, and its "done when" requires
   watching a real send and reply in production.
4. **Wire Wrenchlane to the control plane.** Everything for it exists and is verified. Read
   the pre-flight check in the runbook first: it is no longer a no-op.
5. **A custom domain for the console**, which is on a `.vercel.app` hostname.

Worth saying plainly: **phases 01 to 10 made the codebase able to serve several customers.
They did not make it able to stand one up.** That gap is phase 11, and it is small — but it
is the difference between the architecture being right and there being three customers.

## Acceptance test for the whole programme

**Standing up Spennare (phase 09) should take about one day.** If it takes a week, the
generalisation in phases 02 to 05 was not finished, and the fix is to go back rather than
to push through.
