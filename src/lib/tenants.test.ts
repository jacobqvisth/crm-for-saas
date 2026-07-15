import { describe, it, expect } from "vitest";
import {
  tenantForHost,
  tenantForEmailDomain,
  isOnboardingAllowed,
  DEFAULT_TENANT_SLUG,
} from "./tenants";

describe("tenantForHost", () => {
  it("maps the WrenchLane host", () => {
    expect(tenantForHost("crm-for-saas.vercel.app").slug).toBe("wrenchlane");
  });

  it("maps the Kundbolaget host", () => {
    expect(tenantForHost("crm-kundbolaget.vercel.app").slug).toBe("kundbolaget");
  });

  it("ignores port and casing", () => {
    expect(tenantForHost("CRM-Kundbolaget.vercel.app:443").slug).toBe(
      "kundbolaget",
    );
  });

  it("falls back to the default tenant for unknown / preview hosts", () => {
    expect(tenantForHost("some-preview-abc123.vercel.app").slug).toBe(
      DEFAULT_TENANT_SLUG,
    );
    expect(tenantForHost(null).slug).toBe(DEFAULT_TENANT_SLUG);
    expect(tenantForHost(undefined).slug).toBe(DEFAULT_TENANT_SLUG);
  });
});

describe("tenantForEmailDomain / isOnboardingAllowed", () => {
  it("resolves WrenchLane primary + alias domains", () => {
    expect(tenantForEmailDomain("wrenchlane.com")?.slug).toBe("wrenchlane");
    expect(tenantForEmailDomain("wrenchlane.co")?.slug).toBe("wrenchlane");
  });

  it("resolves Kundbolaget domain", () => {
    expect(tenantForEmailDomain("kundbolaget.se")?.slug).toBe("kundbolaget");
  });

  it("is case-insensitive", () => {
    expect(tenantForEmailDomain("Wrenchlane.Com")?.slug).toBe("wrenchlane");
  });

  it("rejects domains not on the allow-list", () => {
    expect(tenantForEmailDomain("gmail.com")).toBeNull();
    expect(tenantForEmailDomain("hantverkarbolaget.se")).toBeNull();
    expect(tenantForEmailDomain("")).toBeNull();
    expect(tenantForEmailDomain(undefined)).toBeNull();
    expect(isOnboardingAllowed("gmail.com")).toBe(false);
    expect(isOnboardingAllowed("kundbolaget.se")).toBe(true);
  });
});
