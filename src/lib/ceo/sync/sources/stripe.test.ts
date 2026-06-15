import { describe, expect, it } from "vitest";
import { buildPaidInvoiceMap } from "./stripe";

describe("buildPaidInvoiceMap", () => {
  it("ignores unpaid and zero-amount invoices", () => {
    const map = buildPaidInvoiceMap([
      { status: "open", amount_paid: 0, subscription: "sub_open", created: 1 },
      { status: "paid", amount_paid: 0, subscription: "sub_trial", created: 2 },
      { status: "void", amount_paid: 5000, subscription: "sub_void", created: 3 },
    ]);

    expect(map.size).toBe(0);
  });

  it("records the earliest paid timestamp per subscription", () => {
    const map = buildPaidInvoiceMap([
      {
        status: "paid",
        amount_paid: 7900,
        subscription: "sub_a",
        status_transitions: { paid_at: 1_700_000_200 },
      },
      {
        status: "paid",
        amount_paid: 7900,
        subscription: "sub_a",
        status_transitions: { paid_at: 1_700_000_100 },
      },
    ]);

    expect(map.get("sub_a")).toBe(new Date(1_700_000_100 * 1000).toISOString());
  });

  it("falls back to invoice.created when paid_at is missing", () => {
    const map = buildPaidInvoiceMap([
      { status: "paid", amount_paid: 1900, subscription: "sub_b", created: 1_700_000_000 },
    ]);

    expect(map.get("sub_b")).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("resolves the subscription id from the newer parent shape", () => {
    const map = buildPaidInvoiceMap([
      {
        status: "paid",
        amount_paid: 19500,
        created: 1_700_000_000,
        parent: { subscription_details: { subscription: "sub_c" } },
      },
    ]);

    expect(map.has("sub_c")).toBe(true);
  });

  it("resolves the subscription id from line items and object refs", () => {
    const map = buildPaidInvoiceMap([
      {
        status: "paid",
        amount_paid: 19500,
        created: 1_700_000_000,
        lines: { data: [{ subscription: { id: "sub_d" } }] },
      },
    ]);

    expect(map.has("sub_d")).toBe(true);
  });
});
