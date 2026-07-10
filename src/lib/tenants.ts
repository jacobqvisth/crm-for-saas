/**
 * Multi-tenant configuration.
 *
 * The CRM runs as a single Next.js app / single Vercel deployment serving
 * multiple companies ("tenants"). Which tenant a request belongs to is derived
 * from the incoming Host header (for pre-login branding) and, after login, from
 * the user's `workspace_members` row (the real data boundary — enforced by RLS).
 *
 * This module is the single source of truth for:
 *   - which hosts map to which tenant (branding before login)
 *   - which email domains are ALLOWED to onboard, and into which tenant
 *
 * It is intentionally isomorphic (no server-only imports) so both server
 * components (login page, auth callback) and client components (branding) can
 * use it.
 */

export type TenantConfig = {
  /** Stable identifier used in code. */
  slug: string;
  /** Full brand name shown in the UI. */
  name: string;
  /** Email domains whose users may onboard into this tenant. */
  emailDomains: string[];
  /** Accent colour (hex) for the logo badge + primary button. */
  accent: string;
  /** Single letter shown in the logo badge. */
  initial: string;
  /** Sub-heading on the login screen. */
  tagline: string;
  /** Production host this tenant lives on (used to route users to their own domain). */
  canonicalHost: string;
};

export const TENANTS: TenantConfig[] = [
  {
    slug: "wrenchlane",
    name: "WrenchLane",
    emailDomains: ["wrenchlane.com", "wrenchlane.co"],
    accent: "#4f46e5", // indigo-600
    initial: "W",
    tagline: "Sign in to your WrenchLane workspace",
    canonicalHost: "crm-for-saas.vercel.app",
  },
  {
    slug: "kundbolaget",
    name: "Kundbolaget",
    emailDomains: ["kundbolaget.se"],
    accent: "#0f766e", // teal-700
    initial: "K",
    tagline: "Sign in to your Kundbolaget workspace",
    canonicalHost: "crm-kundbolaget.vercel.app",
  },
];

/** Host (without port) → tenant slug. Both are free `.vercel.app` aliases on the same project. */
export const HOST_TENANT: Record<string, string> = {
  "crm-for-saas.vercel.app": "wrenchlane",
  "crm-kundbolaget.vercel.app": "kundbolaget",
  // Local dev + preview deploys fall through to the default tenant.
  localhost: "wrenchlane",
};

export const DEFAULT_TENANT_SLUG = "wrenchlane";

function normalizeHost(host?: string | null): string {
  return (host ?? "").split(":")[0].trim().toLowerCase();
}

/** Resolve the tenant to brand a request for, based on the Host header. */
export function tenantForHost(host?: string | null): TenantConfig {
  const slug = HOST_TENANT[normalizeHost(host)] ?? DEFAULT_TENANT_SLUG;
  return TENANTS.find((t) => t.slug === slug) ?? TENANTS[0];
}

/** The tenant an email domain belongs to, or null if the domain is not on the allow-list. */
export function tenantForEmailDomain(domain?: string | null): TenantConfig | null {
  if (!domain) return null;
  const d = domain.trim().toLowerCase();
  return TENANTS.find((t) => t.emailDomains.includes(d)) ?? null;
}

/** True if a user with this email domain is allowed to onboard at all. */
export function isOnboardingAllowed(domain?: string | null): boolean {
  return tenantForEmailDomain(domain) !== null;
}
