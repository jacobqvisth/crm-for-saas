# Operating the control plane

The console that decides which features each customer gets. It is deployed, and this is how
to run it.

- **Console:** https://wrenchlane-control-plane.vercel.app/admin
- **Vercel project:** `wrenchlane-control-plane` (`prj_8LG0FKZfeugFtiK8tuMcXQN9Oj2h`)
- **Database:** Supabase `ktkuwmuhhrbwzysuxfzi` (`wrenchlane-control-plane`, eu-north-1)
- **Branch of record:** `stable`

## The one thing to understand first

This console holds **no customer data and no tenant keys**. It stores feature flags and
non-sensitive settings; tenants pull their own row with a token scoped to themselves.
Compromise it and you can turn features on and off, not read anyone's CRM.

That is a deliberate design, and the obvious "simplification" destroys it. A console that
held each tenant's service-role key would be one credential that reads every customer's
entire database. **Do not add a key column.**

## Why it is not connected to Git

The tenant project and the control plane are the same repository. Connecting the second one
to Git would have meant two problems, so it is deployed from the CLI instead:

1. **`vercel.json` registers 18 cron schedules.** A Git-connected control plane inherits all
   18 and fires the tenant's send, mailbox-sync and reply-check crons against a database with
   no CRM tables — every few minutes, for ever. The CLI deploy uses
   `vercel.control-plane.json`, which sets `"crons": []`.
2. Every CRM pull request would produce a second preview build, and previews on this repo
   always fail. Two red checks per PR, one of them meaningless.

The cost is that the console does not redeploy itself. That is the right trade for something
that changes rarely and governs three businesses.

## Deploying a change

```bash
git checkout stable && git merge --ff-only main && git push origin stable
npx vercel link --yes --project wrenchlane-control-plane --scope jacobqvisths-projects
npx vercel deploy --prod --yes -A vercel.control-plane.json
```

`-A vercel.control-plane.json` is not optional. Without it the deploy picks up the tenant
`vercel.json` and its 18 crons. That file also carries `"framework": "nextjs"`; without it
Vercel deploys the directory as static files, the build takes 0 ms, and **every route 404s**
while the deployment still reports READY.

Verify after deploying:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://wrenchlane-control-plane.vercel.app/admin      # 307
curl -s -o /dev/null -w '%{http_code}\n' https://wrenchlane-control-plane.vercel.app/contacts   # 404
curl -s https://wrenchlane-control-plane.vercel.app/api/config                                  # 401
```

## What this deployment serves, and what it must not

`IS_CONTROL_PLANE=1` flips the app into console mode, and `src/middleware.ts` then serves a
deny-by-default allow-list: `/admin`, `/api/config`, `/login`, `/auth/callback`, and `/`
which redirects to the console. Everything else 404s.

It is an allow-list rather than a block-list on purpose. A route added to the CRM tomorrow
is closed here without anyone remembering to close it.

`/auth/callback` short-circuits on this deployment before the tenant workspace onboarding.
That is load-bearing: the onboarding queries `workspace_members` and `workspaces`, which do
not exist in the control-plane database, and without the short-circuit a legitimate super
admin is bounced to `/login?error=onboarding` with nothing explaining why.

## Signing in

Authorisation is `CONTROL_PLANE_ADMIN_EMAILS`, re-checked in the page and in every server
action. Middleware is a convenience, not the boundary. The rules are stricter than the CRM's
`CEO_ALLOWED_EMAILS`: the address must match exactly, the email must be confirmed, the
provider must be Google, and `@domain` entries are dropped rather than honoured, because the
primary super-admin address is a Gmail one and `@gmail.com` would admit the internet.

**The super-admin Google account controls feature access for three paying customers. It
needs a hardware key or a passkey, not SMS.**

## Wiring a tenant to it

A tenant runs on compiled defaults until it is given a URL and a token. That is a supported
state, not a broken one — Wrenchlane has run that way since phase 05.

1. In the console, use **Rotate token** on the tenant. The plaintext is shown once and never
   stored; only a SHA-256 goes in the database.
2. On that tenant's Vercel project set `CONTROL_PLANE_URL=https://wrenchlane-control-plane.vercel.app`
   and `CONTROL_PLANE_TOKEN=<the token>`, then redeploy.
3. Confirm the tenant still serves every feature it served before.

Rolling back is unsetting `CONTROL_PLANE_URL`.

### Read this before wiring Wrenchlane

Phase 05 established that the resolver falls back live → cache in the tenant's own database
→ compiled defaults, and that a control-plane outage is therefore not a tenant outage. It
also established the trap: **the cache lives in the tenant's production database, so a bad
pull is persisted.** A session once wrote `forums: false` into Wrenchlane's production cache
from a local run and would have taken the feature away in production.

So before wiring a live tenant, check that `/api/config` with that tenant's token returns
every feature the tenant already has. If the flags match the compiled defaults, wiring
changes nothing, which is exactly the state to be in when you turn it on.

## Still to do

- **Google sign-in is not enabled yet**, so nobody can actually sign in. It needs an OAuth
  client the control plane owns. Deliberately not the CRM's client: that secret belongs to
  the Wrenchlane tenant, and ground rule R7 says no credential crosses a tenant boundary.

  In Google Cloud Console, create an OAuth client ID of type **Web application** with the
  authorized redirect URI `https://ktkuwmuhhrbwzysuxfzi.supabase.co/auth/v1/callback`, then
  put its id and secret into the control-plane Supabase auth settings and enable Google.

  Everything else is already locked down: zero providers enabled, sign-up disabled, and the
  redirect allow-list holds exactly
  `https://wrenchlane-control-plane.vercel.app/auth/callback`. **Never append a query string
  to `redirectTo`** — Supabase matches the whole string against the allow-list.

- **A custom domain.** The console is on a `.vercel.app` hostname. Moving it means adding the
  domain in Vercel, then updating `site_url` and the redirect allow-list in Supabase, and
  changing `CONTROL_PLANE_URL` on every wired tenant.
