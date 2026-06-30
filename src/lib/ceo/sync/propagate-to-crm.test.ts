import { describe, expect, it } from "vitest";
import { deriveContactLeadStatus } from "./propagate-to-crm";

describe("deriveContactLeadStatus", () => {
  it("promotes an active subscriber to customer", () => {
    expect(deriveContactLeadStatus("active", "contacted")).toBe("customer");
    expect(deriveContactLeadStatus("active", "new")).toBe("customer");
    expect(deriveContactLeadStatus("active", "unqualified")).toBe("customer");
  });

  it("treats past_due as a (dunning) customer, matching the company customer_status", () => {
    // The screenshot case: small_monthly + past_due, lead_status stuck at "contacted".
    expect(deriveContactLeadStatus("past_due", "contacted")).toBe("customer");
  });

  it("returns null when already a customer (no redundant write)", () => {
    expect(deriveContactLeadStatus("active", "customer")).toBeNull();
    expect(deriveContactLeadStatus("past_due", "customer")).toBeNull();
  });

  it("demotes a previously-synced customer to churned when the sub lapses", () => {
    for (const s of [
      "canceled",
      "cancelled",
      "unpaid",
      "incomplete_expired",
      "paused",
      "inactive",
    ]) {
      expect(deriveContactLeadStatus(s, "customer")).toBe("churned");
    }
  });

  it("does NOT clobber a rep's win-back funnel state on a lapsed account", () => {
    // Not currently "customer" → leave whatever sales set.
    expect(deriveContactLeadStatus("canceled", "engaged")).toBeNull();
    expect(deriveContactLeadStatus("canceled", "qualified")).toBeNull();
    expect(deriveContactLeadStatus("inactive", "contacted")).toBeNull();
  });

  it("leaves trials and unknown/missing statuses to sales", () => {
    expect(deriveContactLeadStatus("trialing", "contacted")).toBeNull();
    expect(deriveContactLeadStatus("trialing", "customer")).toBeNull();
    expect(deriveContactLeadStatus(null, "contacted")).toBeNull();
    expect(deriveContactLeadStatus("something_new", "contacted")).toBeNull();
  });

  it("is case-insensitive on the subscription status", () => {
    expect(deriveContactLeadStatus("ACTIVE", "new")).toBe("customer");
    expect(deriveContactLeadStatus("Canceled", "customer")).toBe("churned");
  });
});
