import { describe, expect, it, vi } from "vitest";
import {
  deriveCustomerStatus,
  deriveLifecycleStage,
  lookupSelfAttribution,
  normalizeCompanyName,
  normalizePhone,
} from "./matching";

describe("normalizePhone", () => {
  it("matches the same number across country-code / formatting differences", () => {
    expect(normalizePhone("+46 70 123 45 67")).toBe(
      normalizePhone("070-1234567"),
    );
  });

  it("keeps the last 9 significant digits", () => {
    expect(normalizePhone("+46701234567")).toBe("701234567");
  });

  it("returns empty for too-short or missing input", () => {
    expect(normalizePhone("12345")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

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

describe("lookupSelfAttribution", () => {
  function makeSupabase(sends: Array<{ id: string; enrollment_id: string | null; sent_at: string; status: string }>, enrollment: { sequence_id: string } | null = null) {
    const lt = vi.fn();
    const order = vi.fn();
    const limit = vi.fn();

    const queueChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt,
      order,
      limit,
    };
    queueChain.lt = vi.fn().mockReturnValue(queueChain);
    queueChain.order = vi.fn().mockReturnValue(queueChain);
    queueChain.limit = vi.fn().mockResolvedValue({ data: sends });

    const enrollmentChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: enrollment }),
    };

    const from = vi.fn((table: string) =>
      table === "email_queue" ? queueChain : enrollmentChain,
    );

    return { from, queueChain };
  }

  it("falls back to now() when signupAt is null", async () => {
    const { from, queueChain } = makeSupabase([
      { id: "send-1", enrollment_id: null, sent_at: "2026-05-01T00:00:00Z", status: "sent" },
    ]);
    const result = await lookupSelfAttribution({ from } as never, "c1", null);
    expect(result).not.toBeNull();
    const upperArg = queueChain.lt.mock.calls[0]?.[1];
    expect(typeof upperArg).toBe("string");
    // Should be an ISO timestamp roughly now (not the historic test data)
    expect(new Date(upperArg).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("returns the send when signupAt is provided", async () => {
    const { from, queueChain } = makeSupabase([
      { id: "send-1", enrollment_id: null, sent_at: "2026-05-01T00:00:00Z", status: "sent" },
    ]);
    const result = await lookupSelfAttribution({ from } as never, "c1", "2026-05-22T00:00:00Z");
    expect(result).toEqual({ sendId: "send-1", sequenceId: null, sentAt: "2026-05-01T00:00:00Z" });
    expect(queueChain.lt).toHaveBeenCalledWith("sent_at", "2026-05-22T00:00:00Z");
  });

  it("returns null when there are no sends matching the temporal bound", async () => {
    const { from } = makeSupabase([]);
    const result = await lookupSelfAttribution({ from } as never, "c1", "2026-05-22T00:00:00Z");
    expect(result).toBeNull();
  });
});

describe("deriveLifecycleStage", () => {
  it("trial when subscription is trialing", () => {
    expect(deriveLifecycleStage("trialing", "small_monthly")).toBe("trial");
  });

  it("paying when subscription is active on a paid plan", () => {
    expect(deriveLifecycleStage("active", "small_monthly")).toBe("paying");
    expect(deriveLifecycleStage("active", "small_yearly")).toBe("paying");
    expect(deriveLifecycleStage("active", "large_monthly")).toBe("paying");
    expect(deriveLifecycleStage("active", "large_yearly")).toBe("paying");
  });

  it("freemium when subscription is active on the free tier (or unknown plan)", () => {
    expect(deriveLifecycleStage("active", "free")).toBe("freemium");
    expect(deriveLifecycleStage("active", null)).toBe("freemium");
  });

  it("churned on canceled", () => {
    expect(deriveLifecycleStage("canceled", "small_monthly")).toBe("churned");
  });

  it("null for unknown subscription status", () => {
    expect(deriveLifecycleStage("weird", "free")).toBeNull();
  });
});
