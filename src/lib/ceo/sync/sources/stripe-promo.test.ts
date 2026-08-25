import { describe, expect, it } from "vitest";
import { buildPromoGrants } from "./stripe";

const COUPON_90 = {
  id: "cpn_90",
  name: "90% discount",
  percent_off: 90,
  duration: "repeating",
  duration_in_months: 14,
};

const identity = new Map([
  [
    "cus_a",
    { email: "shop@example.se", workshopId: "ws_a", internalUserId: "usr_a" },
  ],
]);

describe("buildPromoGrants", () => {
  it("folds one coupon across many invoices into a single grant", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          currency: "usd",
          created: 1_700_000_000,
          amount_paid: 800,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 7100, discount: "di_1" }],
        },
        {
          customer: "cus_a",
          currency: "usd",
          created: 1_700_500_000,
          amount_paid: 800,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 7100, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].invoice_count).toBe(2);
    expect(grants[0].total_discount_cents).toBe(14200);
    expect(grants[0].total_paid_cents).toBe(1600);
    expect(grants[0].source).toBe("invoice");
    expect(grants[0].active_on_subscription).toBe(false);
    expect(grants[0].first_applied_at).toBe(
      new Date(1_700_000_000 * 1000).toISOString(),
    );
    expect(grants[0].last_applied_at).toBe(
      new Date(1_700_500_000 * 1000).toISOString(),
    );
  });

  it("carries the customer's workshop and app user through", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants[0].customer_email).toBe("shop@example.se");
    expect(grants[0].workshop_id).toBe("ws_a");
    expect(grants[0].internal_user_id).toBe("usr_a");
  });

  it("resolves a promotion code id to the human code", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          discounts: [
            { id: "di_1", coupon: COUPON_90, promotion_code: "promo_1" },
          ],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map([["promo_1", "WRENCHLANE90"]]),
      identityByCustomer: identity,
    });

    expect(grants[0].promotion_code).toBe("WRENCHLANE90");
    expect(grants[0].promotion_code_id).toBe("promo_1");
    expect(grants[0].metadata.promotion_codes).toEqual(["WRENCHLANE90"]);
  });

  it("does not split a coupon applied both by code and by hand", () => {
    // The real failure this guards: keying a grant on the promotion code turned
    // one discounted customer into two half-grants and double-counted them.
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          discounts: [
            { id: "di_1", coupon: COUPON_90, promotion_code: "promo_1" },
          ],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
        {
          customer: "cus_a",
          created: 2,
          discounts: [{ id: "di_2", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 100, discount: "di_2" }],
        },
      ],
      promotionCodeNames: new Map([["promo_1", "WRENCHLANE90"]]),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].invoice_count).toBe(2);
    expect(grants[0].promotion_code).toBe("WRENCHLANE90");
  });

  it("marks a live subscription discount as active and reports 'both'", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [
        {
          subscriptionId: "sub_a",
          status: "active",
          customerId: "cus_a",
          currency: "sek",
          discount: { id: "di_1", coupon: COUPON_90, start: 1_600_000_000 },
        },
      ],
      invoices: [
        {
          customer: "cus_a",
          currency: "sek",
          created: 1_700_000_000,
          amount_paid: 749,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 6741, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].active_on_subscription).toBe(true);
    expect(grants[0].source).toBe("both");
    expect(grants[0].subscription_status).toBe("active");
    expect(grants[0].stripe_subscription_id).toBe("sub_a");
    expect(grants[0].currency).toBe("SEK");
    // The discount's own start date predates the first invoice.
    expect(grants[0].first_applied_at).toBe(
      new Date(1_600_000_000 * 1000).toISOString(),
    );
  });

  it("keeps a fully discounted invoice with no attributed amount", () => {
    // A 100%-off coupon produces a paid invoice with amount_paid 0 and, on some
    // API versions, no total_discount_amounts entry. It is still the only
    // evidence the comp exists, so it must not be dropped.
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          amount_paid: 0,
          discounts: [
            {
              id: "di_free",
              coupon: { id: "cpn_free", percent_off: 100, duration: "forever" },
            },
          ],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].coupon_id).toBe("cpn_free");
    expect(grants[0].invoice_count).toBe(1);
    expect(grants[0].total_discount_cents).toBe(0);
  });

  it("separates two different coupons on the same customer", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
        {
          customer: "cus_a",
          created: 2,
          discounts: [
            {
              id: "di_2",
              coupon: { id: "cpn_50", percent_off: 50, duration: "once" },
            },
          ],
          total_discount_amounts: [{ amount: 200, discount: "di_2" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(2);
    expect(grants.map((grant) => grant.coupon_id).sort()).toEqual([
      "cpn_50",
      "cpn_90",
    ]);
  });

  it("attributes an invoice's paid amount to one coupon only", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          amount_paid: 5000,
          discounts: [
            { id: "di_1", coupon: COUPON_90 },
            {
              id: "di_2",
              coupon: { id: "cpn_50", percent_off: 50, duration: "once" },
            },
          ],
          total_discount_amounts: [
            { amount: 100, discount: "di_1" },
            { amount: 200, discount: "di_2" },
          ],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    const totalPaid = grants.reduce(
      (sum, grant) => sum + grant.total_paid_cents,
      0,
    );
    expect(totalPaid).toBe(5000);
  });

  it("falls back to the invoice email when the customer is unknown", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_unknown",
          customer_email: "orphan@example.se",
          created: 1,
          discounts: [{ id: "di_1", coupon: COUPON_90 }],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants[0].customer_email).toBe("orphan@example.se");
    expect(grants[0].workshop_id).toBeNull();
  });

  it("ignores discounts with no coupon", () => {
    const grants = buildPromoGrants({
      subscriptionDiscounts: [],
      invoices: [
        {
          customer: "cus_a",
          created: 1,
          discounts: [{ id: "di_1" }],
          total_discount_amounts: [{ amount: 100, discount: "di_1" }],
        },
      ],
      promotionCodeNames: new Map(),
      identityByCustomer: identity,
    });

    expect(grants).toHaveLength(0);
  });
});
