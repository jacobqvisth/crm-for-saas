import { describe, expect, it } from "vitest";
import { requiresAuth } from "./middleware";
import { safeNextPath } from "@/lib/auth/next-path";

// Every top-level section under src/app/(dashboard). The old allow-list named
// only ten of these, so the rest rendered their shell to logged-out visitors
// and then failed with a bare "Unauthorized" from the first API call.
const DASHBOARD_SECTIONS = [
  "activation",
  "calls",
  "companies",
  "contacts",
  "dashboard",
  "discovery",
  "domain-portfolio",
  "forums",
  "inbox",
  "lists",
  "roadmap",
  "routes",
  "sequences",
  "settings",
  "tasks",
  "templates",
  "videos",
];

describe("requiresAuth", () => {
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

describe("safeNextPath", () => {
  it("keeps same-site paths, with or without a query string", () => {
    expect(safeNextPath("/forums/answers")).toBe("/forums/answers");
    expect(safeNextPath("/forums/answers?tab=open")).toBe("/forums/answers?tab=open");
  });

  it("rejects anything that could leave the origin", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("evil.com")).toBeNull();
  });

  it("treats missing or empty values as no destination", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
