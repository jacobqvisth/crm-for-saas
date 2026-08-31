# 11. Tenant bring-up: the parts phases 01 to 10 do not cover

**Depends on:** 02, 03, 05. Independent of 07.
**Visible change for Wrenchlane:** none, if done as described.

## Why this brief exists

Phases 01 to 10 make the codebase *able* to serve several customers: one honest migration
baseline, a typed tenant config, a feature registry, a control plane, a config pull, a mail
provider seam. Every one of those was necessary.

None of them stands a customer up.

The four items below were found on 2026-08-31 by looking at what would actually happen if
Animech logged in tomorrow. Each is small. Together they are the difference between "the
architecture supports three customers" and "there are three customers". They are written
here rather than folded into 08 so that 08 is a bring-up and not a discovery exercise.

The acceptance test for the whole programme is that standing up Spennare takes about a day.
It cannot, today, and none of the reasons are in the plan.

---

## A. The product is visibly Wrenchlane

**`src/components/sidebar.tsx` hardcodes `/wrenchlane-mark.png` and
`/wrenchlane-wordmark.png`,** with the alt text "Wrenchlane — AI-Driven Car Diagnostics".
Animech would sign in and see another company's logo above their own pipeline. There is no
polite way to describe that to a customer.

`TenantIdentity` in `src/config/tenants/types.ts` carries `slug`, `legalName`,
`displayName`, `productDescription` and `supportEmail`. It carries **no branding**, so the
sidebar could not read the right logo even if it wanted to.

Measured, not estimated: **68 files under `src/app` and `src/components` mention Wrenchlane,
while 11 files in all of `src` use the tenant config.** Most of those 68 are comments,
prompts and copy that are genuinely Wrenchlane's. The user-visible ones are what matters,
and the sidebar is the one nobody could miss.

**Do:**
- Add a `branding` block to `TenantIdentity`: mark, wordmark, alt text, and the browser
  title. Required, not optional, so `tsc` names every tenant that has not filled it in.
- Serve the assets per tenant. Simplest honest option is `public/tenants/<slug>/…` with the
  path derived from the slug; there is no need for a CDN or an upload flow.
- `src/app/layout.tsx` has `title: "CRM for SaaS"`. Make it the tenant's.
- Then **walk the app as a customer would** and list what still says Wrenchlane. Do not try
  to fix all 68 files; fix what a customer sees, and leave the rest with a note.

**Done when:** booting with `TENANT_SLUG=animech` shows no Wrenchlane asset or wordmark
anywhere a signed-in user can reach.

---

## B. There is no environment manifest, so bring-up is guesswork

Measured on `origin/main`:

- **67 distinct environment variables are read by `src/`.**
- **32 are documented in `.env.local.example`.**
- **43 are read but undocumented** — including `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`,
  `ELKS_API_USERNAME`/`PASSWORD`, `MILLIONVERIFIER_API_KEY`, `SLACK_SIGNING_SECRET`,
  `APIFY_TOKEN` and the whole `ELKS_WEBRTC_*` set.
- **9 are documented but never read** (`TRUSTPILOT_*`, `GBP_*`, `GOOGLE_OAUTH_*`), which is
  worse than missing: someone will go and get a Trustpilot key that nothing uses.

Standing up a tenant against that means discovering three quarters of the configuration by
watching production break, one variable at a time, which is exactly how the Deepgram 401 and
the `NEXT_PUBLIC_APP_URL` incident already happened here.

**Do:**
- Regenerate `.env.local.example` from the code rather than by hand, and keep it that way
  with a script. A generated file cannot drift.
- Group each variable by the **integration flag** it belongs to
  (`TenantIntegrations.deepgram`, `.elks`, `.apify` …). A tenant with `elks: false` should
  be able to see at a glance that it needs none of the `ELKS_*` set.
- Mark each as required / required-for-feature / optional. "Required" should mean the app
  does not boot usefully without it.
- Delete the nine stale entries.

**Done when:** a new tenant's environment can be filled in from one file, and a script fails
if the code reads a variable the file does not mention.

---

## C. A fresh tenant database has a schema and nothing in it

`00000000000000_baseline.sql` creates 101 tables. It creates no workspace, no user, no
sequence, no email template, no pipeline stages. The first sign-in to a new tenant runs the
`/auth/callback` onboarding path, which creates *a* workspace named after the user, which is
not the same as a configured tenant.

There is no bring-up script. `scripts/` has `seed-control-plane.mjs` (a different database),
`provision-switchboard.ts` and `seed-webrtc-endpoint.ts` (both feature-specific).

**Do:**
- `scripts/bootstrap-tenant.mjs`, dry-run by default like every other script here: create
  the workspace with the right name and domain, the owner membership, and whatever minimum
  content makes the app usable rather than empty.
- Decide explicitly what a new tenant should start with. An empty Templates page and an
  empty Sequences page are a bad first impression, but Wrenchlane's own templates are about
  car workshops and must not be copied wholesale.

**Done when:** a fresh Supabase project plus this script produces a CRM someone can sign
into and use, without a human running SQL.

---

## D. Nineteen of twenty features default to ON, and most are Wrenchlane's

R2 already anticipated this. It says flags default on so Wrenchlane never silently loses a
feature, and then: *"New tenants get a config that switches things off; Wrenchlane's config
is the baseline."*

The second half has never been done, and until 2026-08-31 it could not be: there were no
tenant rows to switch anything off for. There are now, and nobody has decided anything.

As it stands Animech and Spennare inherit **DTC codes**, **Videos** (a fault-code YouTube
gallery), **Forums** (answering Reddit car threads), **Reviews** (app-store review
collection), **Dealer network** and **Call agent** — a car diagnostics product, switched on
for a 3D configurator company and a signage company.

Do **not** fix this by flipping registry defaults; that breaks the first half of R2 and takes
features from Wrenchlane. Fix it per tenant in the control plane, which is exactly what it is
for and is now the easiest part of this brief.

**Do:**
- Decide, per new tenant, which of the twenty they get, and record it as overrides with a
  note. The note matters: in six months "why is Forums off for Animech" should be answerable
  from the console.
- Consider adding an `appliesTo` hint on each registry entry — "this feature assumes the
  customer sells car diagnostics" — so the question is asked at bring-up rather than
  discovered by a customer finding a page about fault codes.

**Done when:** every tenant's twenty flags have been decided deliberately rather than
inherited, and the reasons are in the audit log.

---

## What this does not include

**Per-tenant secrets storage.** Each tenant's credentials live in that tenant's own Vercel
project and nowhere else (R5, R7). That is a rule, not a gap, and it must stay that way: the
control plane holds flags and counts, never keys.

**Backups and cost per tenant.** Real, and out of scope here. Worth a decision before the
first customer is billed, not before they are stood up.
