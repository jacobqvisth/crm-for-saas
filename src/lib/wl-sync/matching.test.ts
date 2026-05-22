import { describe, expect, it } from "vitest";
import {
  deriveCustomerStatus,
  deriveLifecycleStage,
  normalizeCompanyName,
} from "./matching";

describe("normalizeCompanyName", () => {
  it("strips Swedish AB suffix", () => {
    expect(normalizeCompanyName("Ingmars Bil i Ystad AB")).toBe(
      "ingmars bil i ystad",
    );
  });

  it("strips Danish A/S and ApS suffixes", () => {
    expect(normalizeCompanyName("Bilcenter A/S")).toBe("bilcenter");
    expect(normalizeCompanyName("Mekonomen ApS")).toBe("mekonomen");
  });

  it("strips Finnish Oy suffix", () => {
    expect(normalizeCompanyName("Autohuolto Oy")).toBe("autohuolto");
  });

  it("collapses diacritics so å/ä/ö match unaccented form", () => {
    expect(normalizeCompanyName("Mårdfeldts Bilservice")).toBe(
      normalizeCompanyName("Mardfeldts Bilservice"),
    );
  });

  it("normalizes whitespace and punctuation", () => {
    expect(normalizeCompanyName("  Ingmars-Bil!  i   Ystad  AB  ")).toBe(
      "ingmars bil i ystad",
    );
  });

  it("returns empty string for a name that is only legal suffix + punctuation", () => {
    expect(normalizeCompanyName("AB ")).toBe("");
  });

  it("preserves a name that doesn't contain a legal suffix", () => {
    expect(normalizeCompanyName("Ingmars Bil i Ystad")).toBe(
      "ingmars bil i ystad",
    );
  });
});

describe("deriveCustomerStatus", () => {
  it.each([
    ["trialing", "trialing"],
    ["active", "active"],
    ["paused", "paused"],
    ["past_due", "inactive"],
    ["inactive", "inactive"],
    ["canceled", "churned"],
    ["cancelled", "churned"],
  ] as const)("maps %s → %s", (input, expected) => {
    expect(deriveCustomerStatus(input)).toBe(expected);
  });

  it("returns null for unknown / nullish", () => {
    expect(deriveCustomerStatus(null)).toBeNull();
    expect(deriveCustomerStatus("weird")).toBeNull();
  });
});

describe("deriveLifecycleStage", () => {
  it("trial when subscription is trialing", () => {
    expect(deriveLifecycleStage("trialing", "small_monthly")).toBe("trial");
  });

  it("paying when subscription is active, regardless of plan_type", () => {
    expect(deriveLifecycleStage("active", "free")).toBe("paying");
    expect(deriveLifecycleStage("active", "small_monthly")).toBe("paying");
    expect(deriveLifecycleStage("active", null)).toBe("paying");
  });

  it("churned on canceled", () => {
    expect(deriveLifecycleStage("canceled", "small_monthly")).toBe("churned");
  });

  it("null for unknown subscription status", () => {
    expect(deriveLifecycleStage("weird", "free")).toBeNull();
  });
});
