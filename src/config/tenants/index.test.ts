import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TENANT_SLUG, getTenant, getTenantBySlug, knownTenantSlugs } from "./index";
import { wrenchlane } from "./wrenchlane";

const originalSlug = process.env.TENANT_SLUG;

afterEach(() => {
  if (originalSlug === undefined) delete process.env.TENANT_SLUG;
  else process.env.TENANT_SLUG = originalSlug;
});

describe("getTenant", () => {
  // This is the phase 02 acceptance criterion: unset and "wrenchlane" must be
  // the same thing, so every existing deployment and dev machine is unaffected.
  it("returns Wrenchlane when TENANT_SLUG is unset", () => {
    delete process.env.TENANT_SLUG;
    expect(getTenant()).toBe(wrenchlane);
  });

  it("returns the same config for TENANT_SLUG=wrenchlane as for unset", () => {
    delete process.env.TENANT_SLUG;
    const implicit = getTenant();
    process.env.TENANT_SLUG = "wrenchlane";
    expect(getTenant()).toBe(implicit);
  });

  it("treats an empty or whitespace TENANT_SLUG as unset", () => {
    process.env.TENANT_SLUG = "   ";
    expect(getTenant()).toBe(wrenchlane);
  });

  // Failing to boot is loud and safe. Booting as the wrong company would send
  // another customer's outbound from Wrenchlane's domains, with Wrenchlane's
  // internal-domain exclusions and Wrenchlane's AI copy. Ground rule R7.
  // Was "animech" until phase 08a registered it. Uses a slug that is genuinely
  // unknown, so the test keeps testing the throw rather than quietly becoming a
  // test that a real tenant exists.
  it("throws on an unknown slug rather than falling back to Wrenchlane", () => {
    process.env.TENANT_SLUG = "acme";
    expect(() => getTenant()).toThrow(/Unknown TENANT_SLUG "acme"/);
  });

  it("names the known tenants in the error, so the fix is obvious", () => {
    process.env.TENANT_SLUG = "typo";
    expect(() => getTenant()).toThrow(/wrenchlane/);
  });
});

describe("the tenant registry", () => {
  it("knows Wrenchlane and Animech; Spennare arrives in phase 09", () => {
    expect(knownTenantSlugs()).toEqual(["wrenchlane", "animech"]);
  });

  // Animech is a real customer on a real deployment, so the things that would
  // leak Wrenchlane into it are worth asserting rather than trusting to review.
  it("gives Animech nothing of Wrenchlane's", () => {
    const a = getTenantBySlug("animech")!;
    expect(a.identity.slug).toBe("animech");
    expect(a.domains.internalDomains).not.toContain("wrenchlane.com");
    expect(a.domains.brandHostTokens).not.toContain("wrenchlane");
    expect(a.ai.knowledge).not.toMatch(/wrenchlane/i);
    expect(a.ai.icpDescription).not.toMatch(/workshop|fault code/i);
    // No sending domain until one is bought and warmed: animech.com publishes
    // SPF ending in -all, so sending from it would be rejected outright.
    expect(a.domains.sendingDomains).toEqual([]);
  });

  it("looks a tenant up by slug and returns undefined for a stranger", () => {
    expect(getTenantBySlug(DEFAULT_TENANT_SLUG)).toBe(wrenchlane);
    expect(getTenantBySlug("spennare")).toBeUndefined();
  });
});

describe("the Wrenchlane config encodes what the code did before phase 02", () => {
  // Each of these was a literal somewhere in src/ before this phase. If one
  // changes, outbound mail, analytics filtering or webhook targets change with
  // it, so they are pinned here deliberately rather than left to review.
  it("keeps the internal-test domains exactly as auto-flag.ts had them", () => {
    expect(wrenchlane.domains.internalDomains).toEqual([
      "wrenchlane.com",
      "codeoc.ai",
      "bitknife.se",
    ]);
  });

  it("keeps the app URL fallback the seven route handlers used", () => {
    expect(wrenchlane.domains.appUrl).toBe("https://crm-for-saas.vercel.app");
  });

  it("keeps the brand host token the Reddit scanner matched on", () => {
    expect(wrenchlane.domains.brandHostTokens).toEqual(["wrenchlane"]);
  });

  it("keeps the send caps from gmail/send.ts and estimate-send-times.ts", () => {
    expect(wrenchlane.mail.defaultDailyLimitPerSender).toBe(80);
    expect(wrenchlane.mail.defaultMinSendIntervalSeconds).toBe(60);
    expect(wrenchlane.mail.defaultProvider).toBe("google");
  });

  it("keeps the Stockholm analytics timezone and the 'en' outbound fallback", () => {
    expect(wrenchlane.locale.timezone).toBe("Europe/Stockholm");
    expect(wrenchlane.locale.defaultLanguage).toBe("en");
  });

  it("carries the full outbound language set from countries.ts", () => {
    expect(wrenchlane.locale.supportedLanguages).toEqual([
      "cs",
      "da",
      "en",
      "et",
      "fi",
      "lv",
      "lt",
      "no",
      "sr",
      "sk",
      "sv",
    ]);
  });

  it("grounds the AI on the one existing knowledge blob, not a copy of it", () => {
    expect(wrenchlane.ai.knowledge).toContain("Wrenchlane — Product knowledge for AI");
  });
});
