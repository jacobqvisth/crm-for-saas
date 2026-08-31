"use client";

import { createContext, useContext } from "react";
import type { TenantIdentity } from "@/config/tenants/types";

/**
 * The tenant's own name, readable from a client component.
 *
 * WHY THIS IS NOT JUST getTenant()
 * --------------------------------
 * `getTenant()` reads `process.env.TENANT_SLUG`. Next.js only inlines
 * `NEXT_PUBLIC_`-prefixed variables into the client bundle, so in the browser
 * that read is `undefined` and getTenant() falls back to the DEFAULT tenant —
 * Wrenchlane. A client component that called it would therefore render
 * "Wrenchlane" for every customer while type-checking perfectly and passing
 * every server-side test. That is precisely the failure this phase exists to
 * remove, so the value is resolved on the server and handed down instead, the
 * same way feature flags already are.
 *
 * Only the plain strings are carried. Anything a customer should not see does
 * not belong in a client bundle.
 */
export type TenantBrand = Pick<
  TenantIdentity,
  "displayName" | "legalName" | "supportEmail"
>;

const BrandContext = createContext<TenantBrand | null>(null);

export function TenantBrandProvider({
  brand,
  children,
}: {
  brand: TenantBrand;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

/**
 * The tenant's display name, for copy and placeholders.
 *
 * Falls back to "your company" outside the provider rather than throwing, and
 * deliberately NOT to "Wrenchlane": a missing provider should read as generic,
 * never as another customer's name.
 */
export function useTenantBrand(): TenantBrand {
  return (
    useContext(BrandContext) ?? {
      displayName: "your company",
      legalName: "your company",
      supportEmail: "",
    }
  );
}
