# 09. Stand up Spennare as tenant three

**Depends on:** 08.
**Visible change for Wrenchlane:** none.

## 09a is DONE (2026-08-31)

**https://spennare-crm.vercel.app** · Supabase `cuzbkkmqyyvjcuoofzvm` · Vercel `spennare-crm`,
not git-connected, deploy with `-A vercel.spennare.json`.

What exists: its own database (121 public tables, 108 with RLS, 8 migrations, identical to the
other two, zero rows), its own tenant config, its own branding, a workspace "K G Spennare AB"
on domain `spennare.com`, generic starter templates and a DRAFT sequence, and its own twenty
flags already decided in the control plane.

What does not: **no user can sign in yet**, exactly as on Animech, and for the same reason —
no provider is enabled, and `email: true` is not a sign-in path without custom SMTP.

**Sign-up was closed BEFORE the deploy** and proved with `422 signup_disabled`, with zero
users created in the window. Two notes for the next tenant, both learned here rather than
from the phase 08 write-up:

- The create-project call died with `ECONNRESET` **after the project had been created**. The
  response was lost and the generated database password with it. Write the intended password
  to disk BEFORE issuing the create call, and treat a dropped connection as "unknown" rather
  than "failed" — check whether the project exists before retrying, or you will make two.
- There **is** an endpoint to set the database password:
  `PATCH /v1/projects/{ref}/database/password`. `PUT` and `POST` on the same path both 404,
  which is what makes it look absent. Knowing it avoided deleting and recreating the project.

The acceptance-test verdict, and the list of five things that needed code rather than config,
is in `README.md` under "Acceptance test for the whole programme".

**09b**, like 08b, is the mail half: a sending domain and Entra consent. Blocked on the same
external step, plus one extra of Spennare's own — `spennare.com` publishes **two conflicting
`v=spf1` records**, which is invalid and can make receivers return permerror. Fixing that is
a free opening gift and should happen before any volume is added.

## This phase is the acceptance test for the whole programme

**It should take about one day.** Follow the same six steps as phase 08 with a different
config and different credentials, and nothing else.

If it takes a week, that is the signal that phases 02 to 05 were not finished. The correct
response is to stop, find what was still hardcoded or still assumed Wrenchlane, and fix it
there. Pushing through by special-casing Spennare bakes the problem in permanently and
makes tenant four worse, not better.

Keep a note of every moment you had to touch code rather than config. That list is the
real backlog for finishing the generalisation.

## Spennare

Designs, manufactures and sells portable exhibition systems: roll-ups, pop-up systems,
folding counters, beach flags, event tents and promotional furniture. Sold **exclusively
through resellers**, present in more than 50 countries. Merged with Faber Exposize.

Their motion is different again from both other tenants: they are not selling to end
customers at all, they are recruiting and managing a dealer network across many markets.

Consequences for the config:

- **Multi-language sequences matter more to them than to anyone.** Per-language step
  variants pinned at enrollment, across 50+ countries. This is the single strongest fit
  in the whole product for this customer, so make sure the language set in their config is
  broad and correct rather than copied from Wrenchlane's Nordic list.
- **Partner and dealer hierarchy** is their shape. Some of it exists already:
  `companies.parent_company_id` for chain and franchise hierarchy, a recent
  `company_is_partner` flag, and a partners settings page. Assess what is there before
  scoping anything new in phase 10.
- **Discovery** means finding distributors and dealers in new markets, a third source
  again. Do not build it here.

Confirm their mail provider before starting. The plan assumes Microsoft. If they are on
Google, nothing changes, because both providers are live. If they are on something else,
that is a third provider and needs its own conversation.

## Done when

- Spennare send a real email from their own domain, from their own deployment, against
  their own database.
- The list of "things I had to change in code rather than config" is written into
  `cc-session-log.md`, honestly, including the small ones.
