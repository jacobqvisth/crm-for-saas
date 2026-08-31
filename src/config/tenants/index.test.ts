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
  it("knows all three tenants, Spennare having arrived in phase 09", () => {
    expect(knownTenantSlugs()).toEqual(["wrenchlane", "animech", "spennare"]);
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

  // Spennare is a real customer on a real config, so the same leak checks that
  // guard Animech guard it too. These are the assertions that would catch a
  // copy-paste from wrenchlane.ts, which is the actual way this goes wrong.
  it("gives Spennare nothing of Wrenchlane's", () => {
    const s = getTenantBySlug("spennare")!;
    expect(s.identity.slug).toBe("spennare");
    expect(s.domains.internalDomains).not.toContain("wrenchlane.com");
    expect(s.domains.brandHostTokens).not.toContain("wrenchlane");
    expect(s.ai.knowledge).not.toMatch(/wrenchlane/i);
    expect(s.ai.icpDescription).not.toMatch(/workshop|fault code/i);
    // No sending domain until one is bought and warmed: spennare.com publishes
    // two conflicting v=spf1 records, which is invalid and can make receivers
    // return permerror.
    expect(s.domains.sendingDomains).toEqual([]);
  });

  // The phase 09 brief singles this out: multi-language sequences are the
  // strongest fit in the product for a reseller network across 30+ countries,
  // and it warns specifically against copying Wrenchlane's Nordic list.
  it("gives Spennare a European language set, not Wrenchlane's", () => {
    const s = getTenantBySlug("spennare")!;
    expect(s.locale.supportedLanguages).not.toEqual(
      wrenchlane.locale.supportedLanguages,
    );
    // The large European display markets their named competitors operate in.
    for (const lang of ["de", "nl", "fr", "es", "it", "pl"]) {
      expect(s.locale.supportedLanguages).toContain(lang);
    }
  });

  it("looks a tenant up by slug and returns undefined for a stranger", () => {
    expect(getTenantBySlug(DEFAULT_TENANT_SLUG)).toBe(wrenchlane);
    // A slug that is genuinely unknown, so this keeps testing the lookup miss
    // rather than quietly becoming a test that a real tenant is absent — which
    // is exactly what happened to the previous version of this line when
    // Spennare was registered.
    expect(getTenantBySlug("acme")).toBeUndefined();
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
