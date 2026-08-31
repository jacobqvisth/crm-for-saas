import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_FEATURES_ENABLED,
  FEATURES,
  FEATURE_KEYS,
  featureForNavHref,
  featureForPath,
  isCronPath,
} from "./features";
import { wrenchlane } from "./tenants/wrenchlane";

const ROOT = join(__dirname, "..", "..");

describe("the registry itself", () => {
  it("has no duplicate keys", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });

  /**
   * R2. A flag that defaults off means Wrenchlane lost a feature the day it
   * merged — which is only untrue for a feature Wrenchlane never had.
   *
   * This list is that exception, spelled out rather than left to judgement, so
   * adding a second one is a deliberate edit to a test and not a quiet `false`
   * in a registry entry. Everything a Wrenchlane user can see today must stay
   * off this list forever.
   */
  const OFF_BY_DEFAULT = new Set<string>(["linkedin_steps"]);

  it("defaults every feature to enabled, except the declared opt-ins", () => {
    for (const f of FEATURES) {
      const expected = !OFF_BY_DEFAULT.has(f.key);
      expect(
        f.enabledByDefault,
        expected
          ? `${f.key} must default to on`
          : `${f.key} is declared opt-in, so it must default to off`,
      ).toBe(expected);
    }
  });

  it("names only real features as opt-in", () => {
    for (const key of OFF_BY_DEFAULT) {
      expect(FEATURE_KEYS as readonly string[]).toContain(key);
    }
  });

  it("gives Wrenchlane every feature it is not opted out of", () => {
    for (const key of FEATURE_KEYS) {
      expect(wrenchlane.features[key], `wrenchlane.${key}`).toBe(!OFF_BY_DEFAULT.has(key));
    }
    expect(Object.keys(ALL_FEATURES_ENABLED).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("declares route prefixes as absolute paths with no trailing slash", () => {
    for (const f of FEATURES) {
      for (const p of [...f.routePrefixes, ...f.cronPaths, ...f.navHrefs]) {
        expect(p.startsWith("/"), `${f.key}: "${p}" must start with /`).toBe(true);
        expect(p.endsWith("/"), `${f.key}: "${p}" must not end with /`).toBe(false);
      }
    }
  });
});

describe("featureForPath", () => {
  it("maps a page and its API to the same feature", () => {
    expect(featureForPath("/forums")).toBe("forums");
    expect(featureForPath("/forums/stats")).toBe("forums");
    expect(featureForPath("/api/forums/replies")).toBe("forums");
  });

  // The whole reason the index is sorted longest-first. Turning DTC off must
  // remove the DTC dashboards without taking the analytics suite with it.
  it("prefers the longest prefix, so /dashboard/dtc-codes is dtc not analytics", () => {
    expect(featureForPath("/dashboard/dtc-codes")).toBe("dtc");
    expect(featureForPath("/dashboard/diagnostic-search-terms")).toBe("dtc");
    expect(featureForPath("/dashboard/revenue")).toBe("product_analytics");
    expect(featureForPath("/dashboard")).toBe("product_analytics");
  });

  it("keeps settings core while gating the feature-specific settings pages", () => {
    expect(featureForPath("/settings")).toBeNull();
    expect(featureForPath("/settings/profile")).toBeNull();
    expect(featureForPath("/settings/calls")).toBe("calling");
    expect(featureForPath("/settings/phone-system")).toBe("calling");
    expect(featureForPath("/settings/field-visits")).toBe("field_routes");
  });

  it("leaves the core product ungated", () => {
    for (const path of [
      "/contacts",
      "/companies",
      "/sequences",
      "/lists",
      "/inbox",
      "/tasks",
      "/templates",
      "/login",
      "/api/contacts",
      "/api/sequences/enroll",
      "/api/inbox",
      "/api/tracking/open/abc",
      "/api/cron/process-emails",
      "/api/cron/check-replies",
      "/api/cron/mailbox-sync",
      "/api/cron/reset-daily-sends",
      "/api/cron/auto-enroll",
      "/api/cron/security-scan",
    ]) {
      expect(featureForPath(path), `${path} must stay core`).toBeNull();
    }
  });

  it("does not match a prefix that is only a string prefix", () => {
    // "/dashboards" is not "/dashboard"
    expect(featureForPath("/dashboardsomething")).toBeNull();
    expect(featureForPath("/callsomething")).toBeNull();
  });
});

describe("crons", () => {
  // Two forum crons live UNDER /api/forums, which is a gated prefix. Without
  // the isCronPath check the middleware would 404 them and Vercel would report
  // a failing schedule every day for a feature that is merely switched off.
  it("recognises the forum crons that sit under a gated prefix", () => {
    expect(isCronPath("/api/forums/mentions/scan")).toBe(true);
    expect(isCronPath("/api/forums/candidates/scan")).toBe(true);
    expect(featureForPath("/api/forums/mentions/scan")).toBe("forums");
  });

  it("does not treat an ordinary feature route as a cron", () => {
    expect(isCronPath("/api/forums/replies")).toBe(false);
    expect(isCronPath("/forums")).toBe(false);
  });

  /**
   * The guard that matters most in this file.
   *
   * Every scheduled job in vercel.json must either be core (runs for every
   * tenant) or be claimed by a feature. Without this, adding a cron for a gated
   * feature and forgetting to register it means that job runs on a customer who
   * switched the feature off, quietly doing work they did not ask for and
   * spending money on APIs they do not have.
   */
  it("accounts for every cron in vercel.json", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const scheduled: string[] = (vercel.crons ?? []).map((c: { path: string }) => c.path);
    expect(scheduled.length).toBeGreaterThan(0);

    // Core crons: outbound sending and hygiene, which every tenant needs.
    const CORE = new Set([
      "/api/cron/process-emails",
      "/api/cron/check-replies",
      "/api/cron/mailbox-sync",
      "/api/cron/reset-daily-sends",
      "/api/cron/auto-enroll",
      "/api/cron/security-scan",
    ]);

    const registered = new Set(FEATURES.flatMap((f) => f.cronPaths));
    const unaccounted = scheduled.filter((p) => !CORE.has(p) && !registered.has(p));
    expect(unaccounted, "add these to a feature's cronPaths, or to CORE above").toEqual([]);
  });

  it("registers no cron path that vercel.json does not schedule", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const scheduled = new Set<string>((vercel.crons ?? []).map((c: { path: string }) => c.path));
    for (const f of FEATURES) {
      for (const p of f.cronPaths) {
        expect(scheduled.has(p), `${f.key} registers ${p}, which vercel.json does not run`).toBe(
          true,
        );
      }
    }
  });
});

describe("navigation", () => {
  const sidebar = readFileSync(join(ROOT, "src", "components", "sidebar.tsx"), "utf8");
  const navHrefs = [...sidebar.matchAll(/\{\s*href:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("finds the sidebar items", () => {
    expect(navHrefs.length).toBeGreaterThan(20);
  });

  // A nav href in the registry that no longer exists in the sidebar is dead
  // config, and worse, it means the feature's nav is no longer being hidden.
  it("only claims nav hrefs the sidebar actually renders", () => {
    for (const f of FEATURES) {
      for (const href of f.navHrefs) {
        expect(navHrefs, `${f.key} claims ${href}`).toContain(href);
      }
    }
  });

  it("maps each claimed href back to its feature", () => {
    expect(featureForNavHref("/forums")).toBe("forums");
    expect(featureForNavHref("/call-agent")).toBe("call_agent");
    expect(featureForNavHref("/receptionist")).toBe("call_agent");
    expect(featureForNavHref("/contacts")).toBeNull();
    expect(featureForNavHref("/settings")).toBeNull();
  });

  it("leaves a core set of nav items that survives every flag being off", () => {
    const survivors = navHrefs.filter((h) => featureForNavHref(h) === null);
    expect(survivors).toEqual([
      "/contacts",
      "/companies",
      "/sequences",
      "/lists",
      "/inbox",
      "/tasks",
      "/templates",
      "/settings",
    ]);
  });
});
