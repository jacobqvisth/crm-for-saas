"use client";

import { createContext, useContext, useMemo } from "react";
import type { FeatureKey } from "@/config/features";

/**
 * Feature flags, readable from a client component.
 *
 * Phase 03 put gating in three places — routes in middleware, nav in the
 * dashboard layout, crons in `cronGate()` — and each of them runs on the
 * server, where `TENANT_SLUG` exists. This is the fourth case that registry
 * anticipated but could not serve: a feature that is neither a page nor a
 * sidebar item, but a control *inside* a page that every tenant can reach.
 * LinkedIn steps are the first of those; they live inside /sequences, which is
 * core product and must stay reachable.
 *
 * The value is still resolved once on the server, in the same layout that
 * resolves the sidebar, so nav and in-page controls cannot disagree.
 *
 * This is presentation only. It hides a control; it does not enforce anything.
 * Every feature gated here must also be enforced server-side, because a client
 * can always post whatever it likes.
 */
const FeaturesContext = createContext<ReadonlySet<FeatureKey> | null>(null);

export function FeaturesProvider({
  enabledFeatures,
  children,
}: {
  enabledFeatures: readonly FeatureKey[];
  children: React.ReactNode;
}) {
  const value = useMemo(() => new Set(enabledFeatures), [enabledFeatures]);
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

/**
 * Whether a feature is on for this tenant.
 *
 * Returns false outside the provider rather than throwing. A component rendered
 * in a context that never resolved flags should hide the optional control, not
 * crash the page it sits on.
 */
export function useFeature(key: FeatureKey): boolean {
  const set = useContext(FeaturesContext);
  return set?.has(key) ?? false;
}
