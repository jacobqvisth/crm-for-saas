# 08. Stand up Animech as tenant two

**Depends on:** 11 for a *usable* tenant. Only the mail half depends on 07.
**Visible change for Wrenchlane:** none.

The first real proof the product works. Everything before this was preparation.

## This phase splits, and the split is the point

The header used to say "Depends on: 07", which held up the whole phase behind an Entra admin
consent in someone else's IT department. Reading the steps, that is only true of step 4.

**08a — a live URL and a live database.** Steps 1, 2, 3 and 5. Needs nothing from Animech and
nothing from Microsoft. This is what produces something you can open in a browser.

**08b — mail and Microsoft sign-in.** Step 4 and the verification in step 6. Genuinely blocked
on `ENTRA-APP-SETUP.md` going through Animech's IT, which is the slowest external step in the
programme and should be started in parallel rather than waited on.

Do 08a first. A tenant that boots, with its own database, that Animech cannot yet send mail
from, is far more useful than a consent request with nothing behind it — not least because
it is the thing to demo while the consent is in someone's queue.

## Who does what

Most of 08a is automatable. The exceptions are decisions and other people's systems, and it
is worth being exact about which is which rather than filing everything under "blocked".

| Step | Who | Waiting on |
| --- | --- | --- |
| Supabase project, `eu-north-1` | agent | **Jacob's approval: $10/month** on the Moringer org |
| Vercel project on this repo, `stable` | agent | nothing |
| Baseline migration via `migrate-tenants.mjs` | agent | nothing |
| Storage buckets and policies | agent | nothing |
| Boot env: `ENCRYPTION_KEY`, `CRON_SECRET`, Supabase keys, `NEXT_PUBLIC_APP_URL` | agent | nothing |
| `src/config/tenants/animech.ts` | agent | phase 11 A, for the branding fields |
| Feature flags off/on | agent | nothing — the list is in step 3 below |
| Workspace, owner, starting content | agent | phase 11 C (`bootstrap-tenant.mjs`) |
| Google sign-in | agent, once the client exists | Jacob, Google Console (~4 clicks) |
| Microsoft sign-in | Animech IT | app registration in **their** tenant |
| Third-party keys for enabled integrations | Jacob | which integrations Animech actually gets |
| Custom domain | Jacob | a domain, and DNS |
| Mail sending + Entra consent | Animech IT | `ENTRA-APP-SETUP.md` |

Note the shape: **nothing in the first block needs a customer.** The customer appears only at
sign-in, mail and domain.

### Before spending anything

$10/month is small, but it is a recurring cost on a customer who has not signed. Ask before
creating the project, and record the answer. The Vercel project is free; the Supabase one is
not.

## Animech

3D configurators and CPQ software, sold to Volkswagen, SKF, Cytiva, Fjällräven, Elfa and
Willab. Around 40 people in Uppsala. Enterprise consultative selling, long cycles, a buying
committee on every deal, hundreds of named accounts. A SOFF member, so aerospace and defence
work is in the mix.

Two consequences: keep the Supabase project in `eu-north-1` (Stockholm), and expect a
security review that will ask exactly the questions ground rule R7 exists to answer.

## Steps

1. **Infrastructure.** New Supabase project in `eu-north-1`, new Vercel project on the same
   repo tracking `stable`, both on Jacob's accounts. Apply the baseline migration with
   `scripts/migrate-tenants.mjs`. Recreate the three storage buckets and their policies.
2. **Environment.** Build `.env.local` from `.env.local.example`. **Never copy Wrenchlane's**
   (ground rule R5). Fresh `ENCRYPTION_KEY` and `CRON_SECRET`. Only the variables Animech's
   enabled features actually need.
3. **Config.** `src/config/tenants/animech.ts`. Register the tenant in the control plane.
   Expected flags off: `dtc`, `videos`, `forums`, `articles`, `reviews`, `field_routes`,
   `call_agent`, `product_analytics`, `journey`, `funnel`, `activation`, `pricing_options`,
   `domain_portfolio`. Expected on: everything core, plus `calling` and `discovery`.
4. **Mail.** Entra app registration in Animech's tenant, app-only, Application Access Policy.
   Sending domain bought and SPF, DKIM and DMARC set as early as possible so reputation
   accumulates while the rest is configured. CRM login moves to Entra ID through Supabase's
   Azure provider.
5. **Crons.** Enable only what Animech's features need. No `pg_cron` jobs (ground rule R6).
6. **Verify.** The full send loop from phase 07's done-list, against Animech's own deployment.

## Then demo it, and let them decide what to cut

The whole reason nothing was deleted is so this conversation can happen with the app in
front of them rather than as a list of guesses. Walk their sales lead through it and turn
flags on and off live in the console.

Two predictions worth checking rather than assuming:

- **Discovery.** The machinery is good but the source is wrong for them. Google Maps finds
  businesses by physical category, which is how you find a car workshop, not how you find
  "a manufacturer with a configurable product". Expect to keep the staging table, the
  review-and-promote screen and the AI scoring, and to need a different connector (phase 10).
- **A deal pipeline is their core need and it does not exist.** It was deleted in PR #357.
  Do not promise it in this phase; scope it in phase 10.

## Done when

- Animech send a real email from their own domain, through their own Microsoft mailbox,
  from their own deployment, recorded against their own database.
- Nothing in Animech's environment references Wrenchlane, verified by reading the env and
  the control-plane row rather than by intention.
- Wrenchlane is unaffected throughout.
