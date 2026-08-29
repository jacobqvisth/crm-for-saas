# 10. Per-tenant features

**Depends on:** 09.
**Visible change for Wrenchlane:** additive only, and only behind flags.

From here the programme stops being infrastructure and becomes ordinary product work.
Each item is its own branch, its own PR and its own flag. Order by which customer is
waiting.

## A. The deal pipeline (`deals`)

**Two of three customers need this and it does not exist.**

The Deals feature was deleted in PR #357, "Remove the Deals feature from the CRM UI".
There are zero code references to `deals`, `pipelines` or `deal_contacts` left, though the
tables survive in the schema. Wrenchlane removed it because they do not sell deal by deal.
Animech does nothing else, and Spennare's dealer agreements are deal shaped too.

Build it further than the kanban that was removed:

- Stages with a weighted forecast, configured per tenant rather than hardcoded
- A buying committee per opportunity, using the **unused `role` column that already exists**
  on `deal_contacts`. Enterprise deals have five to eight stakeholders across procurement,
  engineering and IT, and the current model of one contact to one company does not express that
- An account timeline pulling emails, calls, tasks and deals into one view per company

Get Animech's actual stages, deal sizes and typical cycle length before designing the
forecast. Guessing produces a pipeline nobody uses.

Flag off for Wrenchlane. They deleted it on purpose.

## B. Pluggable discovery sources (`discovery`)

Keep the staging table, the review-and-promote screen and the AI scoring filter. Make the
**source** a plugin behind a small interface:

- Wrenchlane: Apify Google Maps, unchanged
- Animech: account-list import plus a firmographic provider, scored against "does this
  company sell a configurable product"
- Spennare: distributor and dealer discovery per market

The screen and the scoring are the valuable, shared part. The connector is what varies.

Note for capacity planning: Wrenchlane's Apify plan cap has been hit before and the
failures are silent in the app. Each tenant needs its own account sized for its own volume,
and the silent-failure behaviour is worth fixing while you are in there.

## C. Dealer network (`dealer_network`, Spennare)

Assess what already exists before building: `companies.parent_company_id` for hierarchy, the
`company_is_partner` flag, and the partners settings page. The gap is likely to be dealer
territory and market coverage, agreement status, and reporting across a network rather than
a funnel. Scope it with Spennare rather than from first principles.

## D. Contract phase for the two-release renames

Ground rule R3 defers every destructive change. Once all three tenants are confirmed on a
release that no longer reads the old shape, land the removals: drop `gmail_accounts` after
`mail_accounts` has fully replaced it, and any other expand-and-contract pairs opened along
the way.

**Keep a list of open contract steps somewhere visible.** They are easy to forget and each
one is a small permanent tax until it is done.

## E. Housekeeping worth doing while the system is fresh in mind

- Close the multi-tenant isolation leaks. They are not exploitable in this architecture,
  because tenants have separate databases, but closing them is the precondition for ever
  reconsidering a shared database, and they are cheaper to fix now than to rediscover later.
- Fix `CLAUDE.md`: it documents `/deals` as live and still lists Inngest in the stack line.
- Reconcile the Wrenchlane migration history properly, which phase 01 does for the baseline
  but which leaves the archived files worth a final tidy.
