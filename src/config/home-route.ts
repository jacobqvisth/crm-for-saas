// Where a signed-in user lands.
//
// WHY THIS EXISTS
// ---------------
// `/dashboard` was hard-coded as the post-sign-in destination in four places:
// the `/` redirect, the auth callback's default `next`, the middleware's
// bounce off `/login`, and the sidebar logo link. All four predate this
// codebase serving more than one customer, and all four assume `/dashboard`
// exists.
//
// It does not exist for every tenant. `/dashboard` is owned by the
// `product_analytics` feature, which is OFF for Animech — it measures a
// freemium self-serve funnel that a company selling enterprise 3D
// configurators does not have. The result, found by signing in to the live
// Animech deployment on 2026-08-31, was that a user who signed in correctly
// landed on a blank 404, and the logo in the sidebar pointed at the same 404.
// Nothing was broken in the gating; the gating worked. The destination was
// simply a route that tenant had been configured not to have.
//
// So the destination becomes a function of the tenant's enabled features
// rather than a constant.
//
// WRENCHLANE IS UNCHANGED, and that is checked rather than asserted:
// `product_analytics` is on for Wrenchlane (R2 — it inherits every feature),
// so `/dashboard` is the first candidate that passes and every one of the four
// call sites resolves to exactly the string it had hard-coded. See
// `home-route.test.ts`, which pins that.

import { featureForNavHref, featureForPath, type FeatureKey } from "./features";

/**
 * Candidate landing routes, best first.
 *
 * The order mirrors the sidebar: a tenant lands on the first thing it would
 * see at the top of its own navigation. Everything after `/dashboard` is core
 * product — not owned by any feature — so the list cannot run out for a real
 * tenant, and `/settings` is the backstop for the pathological case of a
 * tenant with nothing enabled.
 *
 * Only routes that are safe to land on belong here. A route that needs a
 * selection (a specific contact, a specific sequence) does not.
 */
const HOME_ROUTE_CANDIDATES: readonly string[] = [
  "/dashboard",
  "/contacts",
  "/companies",
  "/sequences",
  "/inbox",
  "/lists",
  "/settings",
];

/** The last resort, if every candidate above is somehow gated off. */
const FALLBACK_HOME_ROUTE = "/settings";

/**
 * The first landing route this tenant actually has.
 *
 * Takes a predicate rather than a `FeatureFlags` record because the callers
 * hold the answer in two different shapes: the server side has the tenant's
 * full flags object, while the sidebar is a client component handed a
 * `FeatureKey[]` that was already resolved server-side. Both can answer "is
 * this key enabled", so that is what this asks for.
 */
export function resolveHomeRoute(
  isEnabled: (key: FeatureKey) => boolean,
): string {
  for (const href of HOME_ROUTE_CANDIDATES) {
    // A candidate is reachable when no feature claims it, or when the feature
    // that claims it is on. Both lookups are consulted because a route can be
    // registered as a nav href, as a route prefix, or as both.
    const key = featureForNavHref(href) ?? featureForPath(href);
    if (key === null || isEnabled(key)) return href;
  }
  return FALLBACK_HOME_ROUTE;
}

/** Convenience for callers holding a plain list of enabled keys. */
export function resolveHomeRouteFromList(enabled: readonly FeatureKey[]): string {
  const set = new Set(enabled);
  return resolveHomeRoute((key) => set.has(key));
}
