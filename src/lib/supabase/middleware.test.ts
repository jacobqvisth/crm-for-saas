import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiresAuth } from "./middleware";

/**
 * Read the sections off disk rather than listing them here. A hard-coded list
 * is what caused the bug this guards: both the middleware's allow-list and the
 * e2e "protected routes" test named only the sections that existed when they
 * were written, so /forums was never checked by either and shipped unguarded.
 * Deriving the list means a new page under (dashboard) is covered the moment
 * it exists, with nobody having to remember to add it.
 */
const DASHBOARD_SECTIONS = readdirSync(join(process.cwd(), "src/app/(dashboard)"), {
  withFileTypes: true,
})
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => e.name);

describe("requiresAuth", () => {
  it("found the dashboard sections to check", () => {
    // Guards the guard: an empty list would make every case below vacuous.
    expect(DASHBOARD_SECTIONS.length).toBeGreaterThan(10);
    expect(DASHBOARD_SECTIONS).toContain("forums");
  });

  it.each(DASHBOARD_SECTIONS)("gates /%s", (section) => {
    expect(requiresAuth(`/${section}`)).toBe(true);
  });

  it.each(DASHBOARD_SECTIONS)("gates nested pages under /%s", (section) => {
    expect(requiresAuth(`/${section}/some/deep/page`)).toBe(true);
  });

  it("gates the forums sub-pages that reported Unauthorized", () => {
    for (const path of [
      "/forums",
      "/forums/answers",
      "/forums/gaps",
      "/forums/accounts",
      "/forums/stats",
      "/forums/distribution",
      "/forums/distribution/abc-123",
    ]) {
      expect(requiresAuth(path)).toBe(true);
    }
  });

  it("gates a section that does not exist yet", () => {
    // The point of the deny-list: tomorrow's page is protected on day one.
    expect(requiresAuth("/some-future-section")).toBe(true);
  });

  it("leaves the public paths open", () => {
    expect(requiresAuth("/")).toBe(false);
    expect(requiresAuth("/login")).toBe(false);
    expect(requiresAuth("/auth/callback")).toBe(false);
  });

  it("does not treat a public prefix as covering unrelated paths", () => {
    // "/login-as-someone-else" must not inherit /login's exemption.
    expect(requiresAuth("/logins")).toBe(true);
    expect(requiresAuth("/authoring")).toBe(true);
  });

  it("never redirects API routes — they answer 401 JSON themselves", () => {
    for (const path of [
      "/api/forums/replies",
      "/api/cron/process-emails",
      "/api/tracking/open",
      "/api/contacts",
    ]) {
      expect(requiresAuth(path)).toBe(false);
    }
  });
});
