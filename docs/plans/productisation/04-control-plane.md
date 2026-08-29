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

## Auth

Supabase Auth on the control-plane project, restricted to an explicit allow-list of
addresses in an environment variable. Not "any authenticated user", not a role column that
a signup could set. There is prior art in this repo for the allow-list pattern
(`CEO_ALLOWED_EMAILS`); reuse the shape, not the variable.

## Done when

- The console lists Wrenchlane, shows every feature with its effective value, and writes
  overrides plus audit rows.
- `IS_CONTROL_PLANE` unset means every console route 404s.
- The control-plane database contains zero customer data and zero tenant keys, verified by
  reading the schema, not by intention.
- Nothing in any tenant app reads from it yet. That is phase 05.
