import { cache } from "react";
import { getTenant } from "@/config/tenants";
import { FEATURES, type FeatureFlags, type FeatureKey } from "@/config/features";

// Resolving this tenant's config, three layers deep.
//
//   1. LIVE PULL   from the control plane, with the tenant's own token
//   2. CACHE       the last good response, in the TENANT'S OWN database
//   3. COMPILED    src/config/tenants/<slug>.ts, from phase 02
//
// The ordering is not the interesting part. The interesting part is that layer
// 3 always exists, so there is no input from the control plane — slow, wrong,
// 500, or entirely deleted — that can stop a tenant serving requests.
//
// THERE IS NO `throw` IN THIS FILE, AND THERE MUST NOT BE ONE.
// A throw here turns a convenience into a dependency, and turns a control-plane
// outage into an outage for three paying businesses. Every failure degrades to
// the next layer and logs.

export interface ResolvedConfig {
  features: FeatureFlags;
  settings: Record<string, unknown>;
  /** Which layer actually answered. Surfaced so the app can log and test it. */
  source: "live" | "cache" | "compiled";
  resolvedAt: string;
}

/** Five minutes, as the brief suggests. A toggle takes effect within one TTL. */
export const CONFIG_TTL_MS = 5 * 60 * 1000;

/** Compiled defaults, layer 3. Always available, never fails. */
export function compiledConfig(): ResolvedConfig {
  return {
    features: getTenant().features,
    settings: {},
    source: "compiled",
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Coerce whatever the control plane sent into a complete, typed flag map.
 *
 * Unknown keys are dropped and missing keys fall back to the compiled value, so
 * a control plane running ahead of this build (or behind it) can never leave a
 * feature undefined. `Boolean()` rather than a truthiness check because a
 * malformed value must resolve to something, not to undefined.
 */
export function normalizeFlags(
  raw: unknown,
  fallback: FeatureFlags = getTenant().features,
): FeatureFlags {
  const incoming = (raw ?? {}) as Record<string, unknown>;
  const out = {} as FeatureFlags;
  for (const f of FEATURES) {
    const v = incoming[f.key];
    out[f.key] = typeof v === "boolean" ? v : fallback[f.key];
  }
  return out;
}

export interface PullResult {
  ok: boolean;
  features?: FeatureFlags;
  settings?: Record<string, unknown>;
  error?: string;
}

/**
 * Layer 1. A single HTTPS GET, with a timeout, that never throws.
 *
 * The timeout is the point: without it a hung control plane becomes a hung
 * tenant, which is the exact failure this whole design exists to prevent.
 */
export async function pullConfig(opts?: {
  url?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PullResult> {
  const url = opts?.url ?? process.env.CONTROL_PLANE_URL;
  const token = opts?.token ?? process.env.CONTROL_PLANE_TOKEN;
  const doFetch = opts?.fetchImpl ?? fetch;
  if (!url || !token) return { ok: false, error: "not configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 3000);
  try {
    const res = await doFetch(`${url.replace(/\/+$/, "")}/api/config`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { features?: unknown; settings?: unknown };
    return {
      ok: true,
      features: normalizeFlags(body.features),
      settings: (body.settings ?? {}) as Record<string, unknown>,
    };
  } catch (err) {
    // Includes the abort. Never rethrown.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export interface ConfigCache {
  read(): Promise<{ features: unknown; settings: unknown; fetchedAt: string } | null>;
  write(v: { features: FeatureFlags; settings: Record<string, unknown> }): Promise<void>;
}

/**
 * The resolver. Live, then cache, then compiled, degrading quietly at each step.
 *
 * `cacheImpl` is injected so the whole ladder is testable without a database,
 * which is what lets the five verifications in the phase 05 brief be real tests
 * rather than a manual checklist.
 */
export async function resolveConfig(opts?: {
  cacheImpl?: ConfigCache | null;
  pull?: typeof pullConfig;
  now?: () => number;
}): Promise<ResolvedConfig> {
  const doPull = opts?.pull ?? pullConfig;
  const cacheImpl = opts?.cacheImpl ?? null;

  // 1. live
  const live = await doPull();
  if (live.ok && live.features) {
    if (cacheImpl) {
      // Best effort. A cache write failure must not fail the request.
      try {
        await cacheImpl.write({ features: live.features, settings: live.settings ?? {} });
      } catch (err) {
        console.warn("[tenant-config] cache write failed", err);
      }
    }
    return {
      features: live.features,
      settings: live.settings ?? {},
      source: "live",
      resolvedAt: new Date().toISOString(),
    };
  }

  console.warn(`[tenant-config] live pull failed (${live.error}); falling back`);

  // 2. cache
  if (cacheImpl) {
    try {
      const cached = await cacheImpl.read();
      if (cached) {
        return {
          features: normalizeFlags(cached.features),
          settings: (cached.settings ?? {}) as Record<string, unknown>,
          source: "cache",
          resolvedAt: cached.fetchedAt,
        };
      }
    } catch (err) {
      console.warn("[tenant-config] cache read failed", err);
    }
  }

  // 3. compiled. Cannot fail.
  console.warn("[tenant-config] no cache either; serving compiled defaults");
  return compiledConfig();
}

/**
 * Request-scoped memo.
 *
 * React's `cache()` dedupes per request, so a page rendering forty components
 * resolves the config once rather than forty times. Without this, the live pull
 * would be a per-component network call.
 */
export const getTenantConfig = cache(async (): Promise<ResolvedConfig> => {
  const { databaseConfigCache } = await import("./cache");
  return resolveConfig({ cacheImpl: databaseConfigCache() });
});

/** Feature check for server components, route handlers and crons. */
export async function isFeatureEnabledLive(key: FeatureKey): Promise<boolean> {
  const cfg = await getTenantConfig();
  return cfg.features[key] === true;
}
