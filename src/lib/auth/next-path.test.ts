import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POST_LOGIN_NEXT_MAX_AGE,
  decodeNextCookie,
  encodeNextCookie,
  safeNextPath,
} from "./next-path";

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

describe("post-login destination cookie", () => {
  it("round-trips a path", () => {
    expect(decodeNextCookie(encodeNextCookie("/forums/answers"))).toBe("/forums/answers");
    expect(decodeNextCookie(encodeNextCookie("/forums/answers?tab=open"))).toBe(
      "/forums/answers?tab=open",
    );
  });

  it("survives a malformed value rather than breaking sign-in", () => {
    // A stray "%" makes decodeURIComponent throw.
    expect(decodeNextCookie("%")).toBeNull();
    expect(decodeNextCookie("%E0%A4%A")).toBeNull();
  });

  it("still refuses an off-site destination smuggled through the cookie", () => {
    expect(decodeNextCookie(encodeNextCookie("//evil.com"))).toBeNull();
    expect(decodeNextCookie("https%3A%2F%2Fevil.com")).toBeNull();
  });

  it("has no destination when the cookie is absent or empty", () => {
    expect(decodeNextCookie(null)).toBeNull();
    expect(decodeNextCookie(undefined)).toBeNull();
    expect(decodeNextCookie("")).toBeNull();
  });

  it("expires soon enough to only cover one OAuth round-trip", () => {
    expect(POST_LOGIN_NEXT_MAX_AGE).toBeGreaterThan(0);
    expect(POST_LOGIN_NEXT_MAX_AGE).toBeLessThanOrEqual(900);
  });
});

/**
 * The regression this guards cost a real user a broken sign-in: appending
 * "?next=..." to the OAuth `redirectTo` stopped it matching Supabase's exact
 * Redirect URL allow-list entry, so Supabase fell back to the project Site URL
 * (http://localhost:3000) and stranded them on "localhost refused to connect".
 * The destination must travel by cookie, never on `redirectTo`.
 */
describe("login page OAuth redirectTo", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(auth)/login/page.tsx"),
    "utf8",
  );

  it("passes a bare /auth/callback with no query string", () => {
    expect(source).toContain("redirectTo: `${window.location.origin}/auth/callback`");
  });

  it("does not build redirectTo from a URL whose search params get mutated", () => {
    const redirectLine = source
      .split("\n")
      .find((l) => l.includes("redirectTo:"));
    expect(redirectLine).toBeDefined();
    expect(redirectLine).not.toMatch(/next/);
    expect(source).not.toMatch(/callback\.searchParams\.set/);
  });

  it("stashes the destination in the cookie instead", () => {
    // References the shared constant rather than a copied literal.
    expect(source).toContain("POST_LOGIN_NEXT_COOKIE");
    expect(source).toContain("document.cookie");
  });
});
