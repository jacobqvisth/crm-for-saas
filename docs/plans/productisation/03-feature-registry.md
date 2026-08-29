# 03. Feature registry, and gate nav, routes and crons

**Depends on:** 02.
**Visible change for Wrenchlane:** none. Every flag defaults to enabled.
**This is the largest code phase.** Expect it to take longer than it looks.

## Goal

Every surface that only makes sense for one customer becomes switchable rather than
removable. This is the inversion that the shared-codebase model forces: Wrenchlane still
needs DTC codes, forums, field routes, the call agent and the analytics suite, so none of
it can be deleted.

## The registry

`src/config/features.ts`: one entry per feature with a stable key, a human name, a
category, a default, and which nav item, route prefixes and cron paths it governs.

Suggested first cut, grouped by who plausibly wants them:

**Core, never gated** (contacts, companies, lists, sequences, templates, snippets, inbox,
tasks, settings, tracking, suppressions, security) - these are the product.

**Gated, Wrenchlane-only today:**

| Key | Covers |
|---|---|
| `dtc` | `/dtc-lookup`, DTC codes dashboards, `dtc_*` tables |
| `videos` | `/videos` |
| `forums` | `/forums/*`, reddit scanning, the two forum crons |
| `articles` | `/articles`, Webflow publishing |
| `reviews` | `/reviews`, `sync-reviews` cron |
| `field_routes` | `/routes/*`, Maps routing |
| `call_agent` | `/call-agent`, `/receptionist`, switchboard, the call-agent crons |
| `calling` | `/calls/*`, click-to-call, transcription (separate from `call_agent`) |
| `product_analytics` | all `/dashboard/*` analytics, `ceo-sync/*`, the `dashboard_*` tables |
| `journey` | `/journey` |
| `funnel` | `/funnel` |
| `activation` | `/activation` |
| `pricing_options` | `/pricing-options` |
| `domain_portfolio` | `/domain-portfolio` |
| `discovery` | `/discovery` and the staging pipeline |

**Gated, not built yet** (declared now, implemented in phase 10): `deals`, `dealer_network`.

## Gating happens in three places, always all three

1. **Navigation.** `src/components/sidebar.tsx` filters its items by the flag map. A hidden
   item is not enough on its own.
2. **Routes.** Pages and API routes for a disabled feature return 404, not an empty page or
   a crash. Add a small `requireFeature()` helper and use it consistently. This is the part
   that actually matters for isolation: a customer must not reach another customer's
   feature by typing the URL.
3. **Crons.** A cron whose feature is off returns 200 with `{ skipped: "feature disabled" }`
   immediately. It must not fail, because a failing cron every five minutes buries the
   Slack alerting channel and trains everyone to ignore it.

## Rules

- Default every flag to **on**. Wrenchlane's config lists no exceptions.
- A gated route must not import a module that crashes at load time when the feature is off.
  Check for top-level side effects in the feature's libraries.
- Server components read flags through the same helper as client components, so a flag has
  exactly one source of truth in the request.
- Do not delete anything. Not one page, not one table, not one cron. Deletion is not part
  of this programme.

## Done when

- Setting every gated flag to off in a local `TENANT_SLUG=scratch` config yields an app
  that builds, boots, shows only core navigation, 404s on every gated route, and runs no
  gated cron.
- Wrenchlane with its own config is indistinguishable from today.
- All four checks pass.

## Traps

- `ceo-legacy.css` contains an unlayered `a{color:inherit}` that beats Tailwind's `text-*`
  on links under `/dashboard`. If you touch nav rendering, use the `!` modifier.
- Some crons are referenced from `vercel.json` by path. Gating the handler is right; leaving
  the path in `vercel.json` is fine, because a disabled feature's cron now returns 200.
- `/api/tracking/*` is deliberately excluded from middleware auth. Do not gate it behind a
  feature check that requires a session.
