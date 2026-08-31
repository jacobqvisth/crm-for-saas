# 11. Tenant bring-up: the parts phases 01 to 10 do not cover

**Depends on:** 02, 03, 05. Independent of 07.
**Visible change for Wrenchlane:** none, if done as described.

## Why this brief exists

Phases 01 to 10 make the codebase *able* to serve several customers: one honest migration
baseline, a typed tenant config, a feature registry, a control plane, a config pull, a mail
provider seam. Every one of those was necessary.

None of them stands a customer up.

Items A to D below were found on 2026-08-31 by looking at what would actually happen if
Animech logged in tomorrow. Item E is a requirement Jacob added the same day. Each is small.
Together they are the difference between "the architecture supports three customers" and
"there are three customers". They are written
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

## E. Sign-in options are per tenant, and Wrenchlane is the exception

Today `/login` offers exactly one button, "Sign in with Google Workspace", hardcoded. That
is right for Wrenchlane and wrong for everyone else: **Animech and Spennare are both on
Microsoft 365**, so their staff would be asked to sign in with the one identity provider they
do not use.

**Required:** every tenant except Wrenchlane offers **Google, Microsoft and email**.
Wrenchlane stays Google-only — it works, its staff are on Workspace, and changing a working
sign-in for a live business buys nothing (R1).

### Do not confuse this with phase 07

These are two different Entra app registrations and conflating them will cost a day:

| | Phase 07 (`ENTRA-APP-SETUP.md`) | This |
| --- | --- | --- |
| Purpose | Send and read **mail** | Let **people sign in** |
| Auth style | App-only, client credentials | Delegated, user consent |
| Permissions | `Mail.Send`, `Mail.ReadWrite`, admin consent, Application Access Policy | `openid`, `profile`, `email` |
| Configured in | The tenant's Vercel env | The tenant's **Supabase** auth settings, as the `azure` provider |
| Who needs it | Only tenants whose mail we send | Every non-Wrenchlane tenant |

The sign-in one is much smaller and needs no Application Access Policy. It can be done long
before the mail consent lands.

### Email sign-in means admin-authorised, not open

Open email sign-up on a CRM is an invitation. The pattern is the one the control plane
already uses and which is proven in production:

- Set **`disable_signup: true`** on that tenant's Supabase project. This is a per-project
  setting, not code, so it belongs on the bring-up checklist in section B — a tenant created
  with it left on default is open to the internet.
- Jacob authorises a person by **creating the user through the admin API** with
  `email_confirm: true`. They then sign in with a magic link or password.
- A first Google or Microsoft sign-in for an address that already exists **links** to that
  user rather than being refused as a signup. That is exactly how the control plane's own
  first sign-in was made to work on 2026-08-31, and it is worth knowing before someone
  debugs "Signups not allowed for this instance" from scratch.

An approval *queue* in the console is deliberately not proposed. Admin-invites is the same
control with none of the build.

### Do

- Add an `auth` block to `TenantConfig`: `{ google: boolean; microsoft: boolean; email:
  boolean }`. Required, not optional, so `tsc` names any tenant that has not decided.
  Wrenchlane is `{ google: true, microsoft: false, email: false }`.
- Render `/login` from it. One button today, three tomorrow, and **no tenant gets a provider
  its Supabase project has not had enabled** — a button that produces "provider is not
  enabled" is worse than no button, and that exact error already cost a round trip this week.
- `src/app/(auth)/auth/callback/route.ts` is provider-agnostic already; check that the
  workspace-onboarding path does the right thing for a Microsoft identity.
- `requireSuperAdmin` in the control plane demands `provider === "google"`. That is the
  **console**, not a tenant, and it stays Google-only. Do not loosen it while doing this.

**Done when:** booting as a non-Wrenchlane tenant shows three working buttons, an
unauthorised email address cannot create an account, and Wrenchlane's login page is
byte-identical to what it is today.

## What this does not include

**Per-tenant secrets storage.** Each tenant's credentials live in that tenant's own Vercel
project and nowhere else (R5, R7). That is a rule, not a gap, and it must stay that way: the
control plane holds flags and counts, never keys.

**Backups and cost per tenant.** Real, and out of scope here. Worth a decision before the
first customer is billed, not before they are stood up.

---

# What was actually done, 2026-08-31

Sections A to E, one branch, one PR. **Wrenchlane is unchanged, and that was proved by
diff rather than asserted**: `/login` is prerendered at build time, so a copy was taken
before any edit and compared after every one. With build-internal chunk hashes and the RSC
flight payload stripped (both change on any edit at all, including a comment), the
user-visible DOM is **byte-for-byte identical at 1961 bytes**, and that file carries the
root layout's `<title>` and `<meta description>` as well as the whole login form. The
sidebar is behind auth and is not prerendered, so `src/config/tenants/branding.test.ts`
pins its four previously-hardcoded strings instead.

## A. Branding

`TenantBranding` is a **required** block on `TenantIdentity`: mark, wordmark, both alt
strings, browser title and description. `tsc` now names any tenant that has not filled it
in. The sidebar takes it as a prop from the dashboard layout, the same route the feature
flags already take, because it is a client component and cannot read `TENANT_SLUG`.

Two deliberate choices worth knowing:

- **Wrenchlane's `browserTitle` is still `"CRM for SaaS"`,** not `"Wrenchlane"`. That
  string is what its tabs say today and R1 forbids changing it here. Renaming it is a
  product decision and a one-line one.
- **Wrenchlane's assets stay at the root of `public/`** rather than moving to
  `public/tenants/wrenchlane/`. Moving them would change the URL of a live asset for no
  benefit. New tenants use `public/tenants/<slug>/`.

`getTenant()` is **not safe in a client component**: Next.js only inlines `NEXT_PUBLIC_`
variables into the browser bundle, so `TENANT_SLUG` is `undefined` there and getTenant()
silently returns the DEFAULT tenant, which is Wrenchlane. A client component calling it
would have rendered "Wrenchlane" for every customer while type-checking perfectly. That is
why `useTenantBrand()` exists and why it falls back to "your company" rather than to
Wrenchlane.

### Walked as a customer, and what still says Wrenchlane

69 files under `src/app` and `src/components` mention Wrenchlane. Almost all of them sit
behind features that are now **off** for both new tenants (the whole `ceo/*` dashboard
suite, forums, videos, dtc-lookup, reviews, mockup, pricing-options, routes, call-agent).
Those are unreachable rather than fixed, which is the right trade.

Fixed, because they are on **always-on** surfaces a customer reaches on day one:

| Where | Was |
| --- | --- |
| `settings/page.tsx` | "What the AI knows about Wrenchlane..." |
| `settings/ai-knowledge` | "What the AI is told about Wrenchlane..." |
| `settings/profile` (x3) | "Founder, Wrenchlane" placeholders |
| `settings/exclusions` | `someone@wrenchlane.com` placeholder |
| `settings/signature-editor-modal` | "Wrenchlane, jacob@wrenchlane.com" placeholder |
| `companies/detail/statuses-tab` | "signed up in the Wrenchlane app" |
| `sequences/email-preview-frame` | `sender_company: "WrenchLane"` |

**Left, with a note, because fixing them would change what Wrenchlane sees:** the signature
placeholders in `settings/profile` still read "Jacob Qvisth". Making them generic is a
visible change to a live business, so it is Jacob's call, not a refactor's.

**One intentional one-character change:** the sequence preview's sample sender company was
the literal `"WrenchLane"`, which is a misspelling of the company's own name. It now comes
from `displayName`, so it reads `"Wrenchlane"`. Revert by dropping the second argument at
the two `previewInterpolate` call sites.

## B. Environment manifest

`src/config/env-manifest.ts` is the single definition; `.env.local.example` is generated
from it by `scripts/env-manifest.mts`, and `--check` runs in the **Build & Lint** job. A
generated file cannot drift.

**The brief's measurements here were wrong, and the correction matters:**

| | Brief said | Actually |
| --- | --- | --- |
| Variables read by `src/` | 67 | **100** |
| Documented | 32 | 32 |
| Documented but never read | 9, "delete them" | **0. All nine are read.** |

The brief measured with a `process.env.` search. That misses `getEnv("NAME")` and
`getRequiredEnv("NAME")`, which is how roughly a third of the configuration is read, and it
misses `process.env[SOME_CONSTANT]` entirely. Every one of the nine allegedly stale
entries, the `TRUSTPILOT_*`, `GBP_*` and `GOOGLE_OAUTH_*` sets, is read through `getEnv()`.
**Deleting them as instructed would have removed live documentation for working
configuration**, which is a worse version of the very problem this section exists to fix.
The scanner therefore understands all three access patterns, and reports computed reads it
cannot resolve rather than staying silent about them.

Each variable is grouped by the integration flag or feature that gates it, and marked
required / required-for-feature / optional / platform. A tenant with `integrations.elks:
false` can see at a glance that it needs none of the eleven `ELKS_*` variables.

## C. Tenant bootstrap

`scripts/bootstrap-tenant.mjs`, dry-run by default. Creates the workspace with the right
name and domain, the owner as a confirmed auth user plus an owner membership, three
deliberately generic starter templates and one **draft** three-step sequence.

- **None of Wrenchlane's templates are copied.** They are about fault codes and would be
  actively misleading in a configurator company's account. The starters are written to be
  rewritten.
- **The sequence is a draft,** so bootstrapping a tenant can never start outbound at
  somebody.
- It **refuses to run against a database that already has a workspace**. Every table is
  scoped by `workspace_id`, so a second workspace does not error, it silently splits the
  customer's data in half.

Proved as far as it can be without a fresh Supabase project: the guard fires, and the
config parsing is correct. Running it against Wrenchlane's own database (a read-only
`SELECT`) turned up the reason this section exists. That database holds **three**
workspaces, and the real one is called **"My Workspace"**. That is exactly the
`/auth/callback` onboarding artefact section C predicts, sitting in production.

**Not proved end to end:** nobody has pointed this at an empty project yet, because there
is no second Supabase project to point it at. The `--apply` path is unexercised.

## D. Per-tenant features

Decided in `scripts/decide-tenant-features.mjs` (dry-run by default), which **refuses to
write Wrenchlane's flags at all**. It is the baseline, and a session has already once put
`forums: false` into its production config from a local run.

All twenty flags are now written explicitly for each new tenant with a note, rather than
left to inherit. An absent row is a real state ("inheriting"), but the brief asks for the
reasons to be answerable from the console in six months, and only a row carries a reason.

| | On | Off |
| --- | --- | --- |
| **Animech** | articles, domain_portfolio | the other 18 |
| **Spennare** | articles, domain_portfolio, discovery | the other 17 |

**17 of Animech's twenty and 16 of Spennare's differed from the registry default**, which
is the size of the problem R2 predicted. Both audit entries are in `audit_log` under actor
`phase-11-tenant-bring-up`. Wrenchlane still has exactly its one pre-existing override.

The two tenants differ on exactly one flag: **discovery**. Google Maps discovery finds
Spennare's exhibition and signage resellers, and does not find Animech's manufacturers.

Switching eighteen of twenty off does not leave a stub. Contacts, companies, sequences,
lists, inbox, tasks, templates and settings are not feature-gated at all.

`appliesTo` was added to every registry entry, one sentence on who the feature is for, so
the question is asked at bring-up rather than discovered by a customer finding a page about
fault codes.

## E. Sign-in per tenant

`TenantAuth { google, microsoft, email }` is a required block. `/login` is now a server
component that reads it and renders `login-form.tsx`; Wrenchlane's
`{ google: true, microsoft: false, email: false }` emits exactly the single Google button
it emitted before, which is what the byte-identical diff above proves.

Verified for a non-Wrenchlane tenant by building with a throwaway tenant slug (created,
built, inspected, deleted, not committed): three buttons render, the title is the tenant's,
and **the string "wrenchlane" appears nowhere in the login DOM**.

- **`auth` is compiled, never pulled from the control plane.** A remotely toggleable
  sign-in flag could lock every user out of a tenant, and the value has to agree with a
  Supabase dashboard setting the control plane cannot see.
- **Email sign-in is admin-invited, never open.** `shouldCreateUser: false` on the client,
  `disable_signup` on the project, and an unknown address gets the same neutral
  confirmation as a known one so the page cannot be used to test whether an account exists.
- **The type's doc comment carries the warning in full:** a `true` here for a provider the
  tenant's Supabase project has not had enabled produces "provider is not enabled" after
  the user has clicked, which is worse than no button.
- `requireSuperAdmin` was **not** loosened. The console stays Google-only.
- The `/auth/callback` onboarding was hardened for Entra identities, which can omit `email`
  (when the account has no `mail` attribute) and send `name` where Google sends
  `full_name`. Without the fallbacks such a user silently lands alone in a new "My
  Workspace" instead of joining their colleagues. **Google always sends both, so every
  fallback is dead code for Wrenchlane.**

## Still not done after this phase

- `scripts/bootstrap-tenant.mjs --apply` has never run against an empty database.
- Neither new tenant has a config in `src/config/tenants/`. That is phase 08/09's job and
  needs facts about the customers; the flags decided in D are waiting for them.
- The residual "Jacob Qvisth" signature placeholders (see A).
