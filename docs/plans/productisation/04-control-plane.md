# 04. Control plane and the super-admin console

**Depends on:** 03.
**Visible change for Wrenchlane:** none. The console exists but nothing consumes it yet.

This is the phase that answers "can I have one settings page for all systems".
Yes, and here is the shape that does not create a credential able to read every
customer's database.

## The trap to avoid

The obvious build is a console holding each tenant's Supabase service-role key, writing
flags straight into each database. Service-role keys bypass RLS entirely. That console
becomes a single credential that can read every contact, every email and every deal of
every customer. One leaked environment variable and the whole book is open.

**Do not build that.** The console never reaches into a tenant. Tenants pull.

## Architecture

```
   Jacob's browser
        |
        v
  control-plane app  ------> control-plane Supabase
  (its own Vercel project)   (tenants, features, flags, audit. NO customer data.)
                                      ^
                                      |  GET /api/config  (token scoped to one tenant)
                                      |
        +-----------------------------+-----------------------------+
        |                             |                             |
   wrenchlane app               animech app                  spennare app
```

The control plane stores **no customer data and no tenant service-role keys**. If it is
compromised, the attacker can toggle features. They cannot read a single row of anyone's
CRM. That is the entire point of the design and it must not be traded away for convenience.

## Where the code lives

In this repo, under `src/app/(control-plane)/`, mounted **only** when
`IS_CONTROL_PLANE=1`. Deployed as a separate Vercel project pointed at the control-plane
Supabase project. Same codebase, so the console and the tenant apps cannot drift apart on
what a feature key means.

When `IS_CONTROL_PLANE` is unset, those routes 404 exactly like a disabled feature. A
tenant deployment must never serve the console.

## Schema (control-plane database only)

- `tenants` - id, slug, display_name, status (`active` | `suspended` | `provisioning`),
  release_channel (`main` | `stable`), supabase_project_ref, app_url, notes, created_at.
  Project refs are stored for display and for the migration script's target list. **Keys
  are not stored here.**
- `features` - key (PK), name, description, category, default_enabled, is_dangerous.
  Seeded from `src/config/features.ts` so the registry stays the single definition.
- `tenant_features` - tenant_id, feature_key, enabled, updated_at, updated_by, note.
  Absent row means "use the feature's default".
- `tenant_settings` - tenant_id, key, value jsonb. For non-boolean per-tenant values that
  should be changeable without a deploy (send caps, cache TTL, alert thresholds).
- `tenant_tokens` - tenant_id, token_hash, created_at, last_used_at, revoked_at. Store a
  hash, never the token. One token per tenant, rotatable.
- `audit_log` - actor, tenant_id, action, before jsonb, after jsonb, at. **Every** write
  through the console appends here. Non-negotiable: this is a page that can turn a paying
  customer's features off.

## The console

One page listing tenants down the side and features across, with a toggle at each
intersection and the effective value shown when no override exists. Plus, per tenant:

- Status, release channel, current deployed commit, last config pull time
- Non-boolean settings
- Token rotation
- The audit trail for that tenant

Design rules:

- A toggle shows **effective** state, and visibly distinguishes "explicitly set" from
  "inheriting the default". Silent inheritance is how you turn something off for a customer
  by accident.
- Turning a feature **off** for a tenant asks for confirmation and a note. Turning one on
  does not. Off is the destructive direction.
- Show when the change will take effect ("within 5 minutes"), because it is a pull, not a push.
- Never render a control that claims to change code. Release channel is displayed, and
  promotion is a git operation. See the README.

## Auth and the super-admin identity

### Who

**`jacob.qvisth@gmail.com`** is the super admin, with authority over all three tenants
(Wrenchlane, Animech, Spennare). Decided by Jacob, 2026-08-29.

Verified against `auth.users`: the account exists with that exact dotted spelling, provider
`google`, email confirmed. So a plain exact-match allow-list entry will match what Google
returns. No normalisation needed.

Using the personal address rather than `jacob@wrenchlane.com` is the right call and worth
recording why: **Wrenchlane is one of the three customers.** An operator identity that lives
on a customer's domain disappears with that domain if the company is ever sold or its
Workspace is closed, and it reads badly to Animech and Spennare that the person holding
their feature switches is administratively part of a competitor's tenant. If this grows past
three customers, move to a dedicated operator domain. Personal Gmail is fine at this size.

Because this account controls feature access for three paying customers it is now the most
privileged credential in the system. It needs a hardware key or passkey, not SMS.

### Two admin tiers, never merged

| Tier | Who | Where | Can do |
|---|---|---|---|
| **Super admin** | Jacob only | the control plane | Set anything for any tenant |
| **Tenant admin** | the customer's own staff | their own deployment's `/settings` | Their own workspace only |

**No customer ever gets control-plane access, not even to their own row.** There is no
"customer toggles their own features" tier, because a feature a customer can switch on is a
feature they have already bought.

### The allow-list is necessary and not sufficient

The existing `CEO_ALLOWED_EMAILS` pattern in `src/app/(dashboard)/reviews/actions.ts` is
sound and worth copying: it lowercases, it uses `===` for plain entries and `endsWith` for
`@domain` entries (no substring hole), and an empty list denies rather than allows. Keep all
four properties.

Then add the things it does not do, because the control plane is a higher-value target than
a reviews page:

1. **Google is the only enabled auth provider** on the control-plane Supabase project.
   Disable email/password and magic link. Note that the CRM project *does* have
   email/password enabled (there is an `e2e-test@...` user on it). Do not copy that.
2. **Public sign-up disabled** on the control-plane project.
3. **Check three things server-side, not one**: the address is allow-listed, the email is
   confirmed, and the identity provider is `google`. Matching the address alone assumes the
   only way to hold an address is to own it.
4. **The allow-list lives in an environment variable** on the control-plane deployment,
   never in a database row. A row is editable by anyone with database access; an env var
   needs deploy access. Do not add an `is_super_admin` column, and do not let one exist.
5. **Never use the `@domain` form here.** `@gmail.com` would admit the entire internet.
   Exact addresses only in the control plane.
6. **Enforce in the route handlers and server actions, not only in middleware.** Middleware
   is a convenience, not a boundary.

### Break-glass

With one admin, losing that Google account means nobody can change features for three
customers. Allow-list a second address as break-glass, on a different provider with a
different recovery path. `jacob@wrenchlane.com` is the obvious candidate: the
customer-domain objection above applies to the *primary* identity, not to a recovery path
that is used once a year.

Document the fallback explicitly: the control-plane database is small and Jacob holds the
Supabase account, so direct SQL is the last resort if both accounts are lost.

> **SUPERSEDED 2026-08-31 by Jacob's decision.** There is no break-glass address.
> `CONTROL_PLANE_ADMIN_EMAILS` is `jacob.qvisth@gmail.com` and nothing else, and the console
> is named `jacobs-crm-control` rather than after a customer. The reasoning above still holds
> in general; the call made here is that a second admin address is a second account to
> compromise for no gain while there is exactly one operator, and that the recovery path is
> the one the last paragraph already names — Jacob owns the Vercel project and the Supabase
> account, so changing the env var and redeploying restores access. See
> `CONTROL-PLANE-RUNBOOK.md`.

### Audit

Every write records which admin address made it. With a single admin that looks like
pointless ceremony, and it is exactly what you will want the first day there are two.

## Done when

- The console lists Wrenchlane, shows every feature with its effective value, and writes
  overrides plus audit rows.
- `IS_CONTROL_PLANE` unset means every console route 404s.
- The control-plane database contains zero customer data and zero tenant keys, verified by
  reading the schema, not by intention.
- Nothing in any tenant app reads from it yet. That is phase 05.
