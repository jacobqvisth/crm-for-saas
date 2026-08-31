// getTenant(): which customer is this deployment serving?
//
// One environment variable, TENANT_SLUG, selects the config at deploy time.
// Unset means Wrenchlane, so every existing deployment and every developer
// machine keeps behaving exactly as it did before this module existed.
//
// getTenant() is synchronous, pure and does no I/O, which is what makes it safe
// to call from a server component, a route handler or a cron without thinking
// about it. Phase 05 adds a live pull from the control plane; it layers ON TOP
// of this rather than replacing it, and this compiled config stays the last
// resort in the three-layer resolution so config can never hard-fail:
//
//   1. live pull from the control plane (short TTL)   [phase 05]
//   2. last good value cached in the tenant database  [phase 05]
//   3. the compiled default, here                     [now]

import type { TenantConfig } from "./types";
import { animech } from "./animech";
import { wrenchlane } from "./wrenchlane";

export type { TenantConfig } from "./types";
export type {
  LanguageCode,
  MailProvider,
  TenantAi,
  TenantDomains,
  TenantIdentity,
  TenantIntegrations,
  TenantLocale,
  TenantMail,
} from "./types";

/**
 * Every tenant this codebase knows how to be.
 *
 * Spennare (phase 09) is deliberately absent. Adding a tenant before its values
 * have been gathered would mean committing guesses, and a wrong committed guess
 * is worse than an obvious gap: it gets read once, believed, and never
 * questioned again.
 *
 * Animech was added in phase 08a. Its config is real but incomplete by design —
 * it cannot send mail, because it has no sending domain and no Entra consent.
 * The gaps are marked TODO(animech) in that file rather than filled in.
 */
const TENANTS: Record<string, TenantConfig> = {
  wrenchlane,
  animech,
};

export const DEFAULT_TENANT_SLUG = "wrenchlane";

/**
 * The config for this deployment.
 *
 * Throws on an unknown slug rather than silently falling back to Wrenchlane.
 * A typo in another customer's environment must not quietly serve them
 * Wrenchlane's domains, internal-domain exclusions and AI copy: that is the
 * failure this whole programme exists to prevent (ground rule R7). Failing to
 * boot is loud, immediate and safe; booting as the wrong company is none of
 * those.
 */
export function getTenant(): TenantConfig {
  const slug = process.env.TENANT_SLUG?.trim();
  if (!slug) return TENANTS[DEFAULT_TENANT_SLUG];

  const tenant = TENANTS[slug];
  if (!tenant) {
    throw new Error(
      `Unknown TENANT_SLUG "${slug}". Known tenants: ${Object.keys(TENANTS).join(", ")}. ` +
        `Add a config in src/config/tenants/ before deploying this slug.`,
    );
  }
  return tenant;
}

/** Look up a specific tenant by slug. Returns undefined when there is none. */
export function getTenantBySlug(slug: string): TenantConfig | undefined {
  return TENANTS[slug];
}

/** Every configured slug, for scripts that iterate tenants. */
export function knownTenantSlugs(): string[] {
  return Object.keys(TENANTS);
}
