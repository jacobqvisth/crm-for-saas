import { describe, it, expect } from "vitest";
import { resolveHomeRoute, resolveHomeRouteFromList } from "./home-route";
import {
  ALL_FEATURES_ENABLED,
  FEATURE_KEYS,
  featureForNavHref,
  featureForPath,
  type FeatureKey,
} from "./features";
import { wrenchlane } from "./tenants/wrenchlane";
import { animech } from "./tenants/animech";

// R1: Wrenchlane is a live business. The point of this change is that a tenant
// WITHOUT product_analytics stops landing on a 404 — and that Wrenchlane, which
// has it, keeps resolving to the identical string that used to be hard-coded in
// all four call sites.
//
// If this test fails, a Wrenchlane user's post-sign-in destination has moved.
// That is exactly the change that must never happen by accident.
describe("Wrenchlane still lands on /dashboard", () => {
  it("resolves to the string the four call sites used to hard-code", () => {
    expect(resolveHomeRoute((k) => wrenchlane.features[k])).toBe("/dashboard");
  });

  it("resolves the same from a plain enabled-key list, as the sidebar does", () => {
    const enabled = FEATURE_KEYS.filter((k) => wrenchlane.features[k]);
    expect(resolveHomeRouteFromList(enabled)).toBe("/dashboard");
  });

  it("holds for any tenant inheriting every feature, which R2 makes the baseline", () => {
    expect(resolveHomeRoute((k) => ALL_FEATURES_ENABLED[k])).toBe("/dashboard");
  });
});

describe("a tenant without product_analytics lands somewhere that exists", () => {
  it("sends Animech to /contacts rather than the /dashboard 404", () => {
    // The bug this file fixes, pinned as the concrete case that was observed
    // on the live deployment: Animech signed in correctly and got a blank 404.
    expect(animech.features.product_analytics).toBe(false);
    expect(resolveHomeRoute((k) => animech.features[k])).toBe("/contacts");
  });

  it("never returns a route the tenant has switched off", () => {
    // Exhaustive rather than illustrative: for every single-feature-off
    // configuration, whatever route comes back must not be one that is gated
    // off. This is the property that actually matters, and it keeps holding
    // when someone adds a feature that claims one of the candidate routes.
    for (const off of FEATURE_KEYS) {
      const flags = { ...ALL_FEATURES_ENABLED, [off]: false };
      const route = resolveHomeRoute((k: FeatureKey) => flags[k]);
      // Re-derive which feature owns the answer and assert it is enabled.
      const owner = featureForNavHref(route) ?? featureForPath(route);
      if (owner !== null) {
        expect(flags[owner], `${route} returned while ${owner} is off`).toBe(true);
      }
    }
  });

  it("still returns a real route when every feature is off", () => {
    // Not "/settings". The candidate list is mostly CORE product — routes no
    // feature owns and no tenant can switch off — so with everything disabled
    // the answer is the first of those, "/contacts". The explicit fallback in
    // home-route.ts is therefore unreachable today; it is kept as a backstop
    // for the day someone puts a feature-owned route in every slot, which is
    // precisely when a silent `undefined` would be worst.
    const route = resolveHomeRoute(() => false);
    expect(route).toBe("/contacts");
    expect(featureForNavHref(route) ?? featureForPath(route)).toBeNull();
  });
});
