import { getTenant } from "@/config/tenants";
import type { FeatureFlags } from "@/config/features";
import { CONFIG_TTL_MS, pullConfig } from "./resolve";

// Flags for code that MUST NOT await a network call: middleware, which runs on
// nearly every request.
//
// The rule from the phase 05 brief is that middleware must not block on the
// live pull. The naive readings of that are both bad: blocking anyway adds a
// round trip to every request, and ignoring pulled config entirely means a
// toggle in the console never affects routing.
//
// So this never blocks and still converges. `peekFlags()` answers instantly
// from a module-level memo, and when that memo is cold or stale it starts a
// refresh WITHOUT awaiting it. The first request after a deploy or a TTL expiry
// is served from compiled defaults or the previous value; the next one, a
// moment later, has the fresh answer.
//
// A module-level memo is right here because a serverless instance is reused
// across requests: at most one pull per TTL per instance, not one per request.
//
// What this memo is and is not the authority for is worth being exact about.
// It decides which FEATURES a tenant sees, which is a commercial control. It is
// not what keeps one customer out of another's data: that is enforced by them
// having separate databases and separate deployments, and no value the control
// plane returns can change it. The worst a compromised control plane achieves
// here is showing or hiding a page.

let memo: { flags: FeatureFlags; fetchedAt: number } | null = null;
let inFlight: Promise<void> | null = null;

function refresh(): void {
  if (inFlight) return;
  inFlight = pullConfig()
    .then((res) => {
      if (res.ok && res.features) {
        memo = { flags: res.features, fetchedAt: Date.now() };
      }
    })
    .catch(() => {
      // Never throws into the request path. A failed refresh simply means the
      // previous answer (or the compiled default) keeps being used.
    })
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Flags right now, without waiting for anything.
 *
 * Returns the memo when fresh, otherwise the compiled defaults, and kicks off a
 * background refresh either way when the memo is cold or stale.
 */
export function peekFlags(): FeatureFlags {
  const fresh = memo && Date.now() - memo.fetchedAt < CONFIG_TTL_MS;
  if (!fresh) refresh();
  return memo ? memo.flags : getTenant().features;
}

/** Testing seam: forget everything this process has learned. */
export function __resetRuntimeFlags(): void {
  memo = null;
  inFlight = null;
}

/** Testing seam: what the memo currently holds, without triggering a refresh. */
export function __peekMemo(): { flags: FeatureFlags; fetchedAt: number } | null {
  return memo;
}
