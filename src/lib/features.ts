// Reading feature flags, and the three ways to act on a disabled one.
//
// Every caller — server component, route handler, cron — goes through here, so
// a flag has exactly one source of truth in a request. The flags themselves
// come from the tenant config (`getTenant().features`), which phase 05 will
// layer a live control-plane pull on top of without any caller changing.
//
// The three responses to "this feature is off" are deliberately different:
//
//   page       404, via Next's notFound()
//   API route  404 JSON
//   cron       200 with { skipped }, NOT an error
//
// The cron case is the one people get wrong. A cron that 404s or 500s every
// five minutes fills the Slack alert channel with noise, and a channel that
// cries wolf is a channel nobody reads when something real breaks.

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { getTenant } from "@/config/tenants";
import {
  FEATURES,
  type FeatureKey,
  type FeatureFlags,
  featureForNavHref,
  featureForPath,
} from "@/config/features";

export type { FeatureKey, FeatureFlags } from "@/config/features";
export { FEATURES, featureForNavHref, featureForPath, isCronPath } from "@/config/features";

/** The flag map for this deployment. */
export function featureFlags(): FeatureFlags {
  return getTenant().features;
}

/** Is this feature switched on for this tenant? */
export function isFeatureEnabled(key: FeatureKey): boolean {
  return featureFlags()[key] === true;
}

/** Every enabled key, for handing to client components as a plain array. */
export function enabledFeatureKeys(): FeatureKey[] {
  const flags = featureFlags();
  return FEATURES.filter((f) => flags[f.key] === true).map((f) => f.key);
}

/**
 * Is this path reachable on this tenant? A path belonging to no feature is core
 * product and always reachable.
 */
export function isPathEnabled(pathname: string): boolean {
  const key = featureForPath(pathname);
  return key === null || isFeatureEnabled(key);
}

/**
 * Guard for a PAGE (server component). Renders the 404 page when the feature is
 * off. Call it before any data fetching so a disabled feature never queries.
 *
 * Note `notFound()` throws, so nothing after it runs.
 */
export function requireFeature(key: FeatureKey): void {
  if (!isFeatureEnabled(key)) notFound();
}

/**
 * Guard for an API ROUTE. Returns a 404 response when the feature is off, or
 * null when it is on:
 *
 *   const off = featureGate("forums");
 *   if (off) return off;
 */
export function featureGate(key: FeatureKey): NextResponse | null {
  if (isFeatureEnabled(key)) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * Guard for a CRON. Returns a 200 "skipped" response when the feature is off,
 * or null when it is on:
 *
 *   const skip = cronGate("reviews");
 *   if (skip) return skip;
 *
 * 200 rather than 404 on purpose: Vercel and the health checker treat a
 * non-2xx cron as a failure, and a disabled feature is not a failure.
 */
export function cronGate(key: FeatureKey): NextResponse | null {
  if (isFeatureEnabled(key)) return null;
  return NextResponse.json({ skipped: "feature disabled", feature: key }, { status: 200 });
}
