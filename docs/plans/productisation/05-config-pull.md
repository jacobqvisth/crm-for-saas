# 05. Tenants pull their config, with cache and fallback

**Depends on:** 04.
**Visible change for Wrenchlane:** none. Values pulled must equal compiled defaults.

## Goal

Make the console's toggles actually take effect, without a deploy, and without any path by
which the control plane can break a tenant.

## Resolution order, three layers deep

1. **Live pull.** `GET {CONTROL_PLANE_URL}/api/config` with the tenant's own token.
   Returns only that tenant's flags and settings. Short TTL, five minutes is a good start.
2. **Cache.** The last successful response, stored in the tenant's **own** database
   (`tenant_config_cache`, one row). Used whenever the pull fails or is stale-but-fresh-enough.
3. **Compiled default.** `src/config/tenants/<slug>.ts` from phase 02. Used when there is
   no cache at all, such as a cold start during a control-plane outage.

A tenant must **never** hard-fail because the control plane is unreachable. If you find
yourself writing `throw` in the pull path, you have built a dependency where you wanted a
convenience.

## The endpoint

- Authenticates by hashing the presented token and matching `tenant_tokens`. Constant-time
  compare. Update `last_used_at`.
- Returns **only** the calling tenant's rows. No tenant id in the request body that could be
  tampered with: the token identifies the tenant.
- Rate limited, and logs failures. A burst of bad tokens is a signal worth seeing.

## Consuming it

`getTenant()` stays synchronous and compiled. Add `getTenantConfig()`, async, returning the
resolved layers, plus a request-scoped memo so a single render resolves once rather than
per component. Feature checks in server components, route handlers and crons go through it.

Middleware runs on nearly every request, so it must not block on a network call. If a flag
is needed there, read it from the cache layer only, never the live pull.

## Verification, which matters more than usual here

This phase is where a mistake silently changes behaviour for a real business. Prove:

- With the control plane reachable and no overrides set, every resolved value equals the
  compiled default. Diff them explicitly in a test.
- With the control plane returning 500, the app serves from cache and logs a warning.
- With the control plane returning 500 **and** the cache empty, the app serves compiled
  defaults and still boots.
- With a wrong token, the endpoint returns 401 and the tenant falls back rather than
  crashing.
- Toggling a flag in the console changes tenant behaviour within the TTL, and appears in
  the audit log.

## Done when

- All five checks above pass.
- Wrenchlane runs on pulled config and behaves identically to before.
- Killing the control plane deployment entirely leaves Wrenchlane fully working.
