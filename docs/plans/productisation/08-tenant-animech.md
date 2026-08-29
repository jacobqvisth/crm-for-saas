# 08. Stand up Animech as tenant two

**Depends on:** 07.
**Visible change for Wrenchlane:** none.

The first real proof the product works. Everything before this was preparation.

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
