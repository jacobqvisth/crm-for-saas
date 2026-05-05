import { describe, expect, it } from "vitest";
import {
  aggregateMetricPoints,
  buildCostEntryRows,
  buildDiagnosticsRows,
  buildUserRows,
  buildWorkshopRows,
  classifyCustomerIoProfile,
  flattenNumericLeaves,
} from "./core-app";

describe("core app helpers", () => {
  it("builds normalized users with hashed email and last seen timestamps", () => {
    const users = buildUserRows([
      {
        email: "Tech@example.com",
        last_active: "2026-04-24T08:00:00.000Z",
        last_login: "2026-04-23T08:00:00.000Z",
        plan_type: "pro",
        user_id: 101,
        user_role: "owner",
        username: "tech",
        workshop_id: 55,
      },
    ]);

    expect(users).toHaveLength(1);
    expect(users[0]?.internal_user_id).toBe("101");
    expect(users[0]?.workshop_id).toBe("55");
    expect(users[0]?.email_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(users[0]?.last_seen_at).toBe("2026-04-24T08:00:00.000Z");
  });

  it("merges Customer.io profile enrichment into normalized users", () => {
    const users = buildUserRows(
      [
        {
          email: "owner@example.com",
          user_id: "u-1",
          workshop_id: "w-1",
        },
      ],
      new Map([
        [
          "u-1",
          {
            country: "SE",
            createdAt: "2026-04-01T00:00:00.000Z",
            customerIoId: "cio-1",
            customerIoProfileId: "profile-1",
            customerIoWorkshopId: "w-1",
            matchType: "id",
            stripeCustomerId: "cus_123",
            subscriptionStatus: "trialing",
          },
        ],
      ]),
    );

    expect(users[0]?.customer_io_id).toBe("cio-1");
    expect(users[0]?.created_at).toBeNull();
    expect(users[0]?.metadata.customer_io_created_at).toBe(
      "2026-04-01T00:00:00.000Z",
    );
    expect(users[0]?.metadata.customer_io_subscription_status).toBe("trialing");
    expect(users[0]?.metadata.customer_io_stripe_customer_id).toBe("cus_123");
    expect(users[0]?.metadata.subscription_status).toBeNull();
    expect(users[0]?.metadata.stripe_customer_id).toBeNull();
  });

  it("only treats exact Customer.io id matches as user-level identity matches", () => {
    expect(
      classifyCustomerIoProfile(
        {
          email: "owner@example.com",
          internalUserId: "u-1",
          workshopId: "w-1",
        },
        {
          email: "owner@example.com",
          id: "u-1",
          workshop_id: "w-1",
        },
      ),
    ).toEqual({
      customerIoInternalUserId: "u-1",
      customerIoWorkshopId: "w-1",
      kind: "user_match",
      workshopBucketAllowed: true,
    });
  });

  it("treats workshop-only Customer.io matches as workshop enrichment, not user identity", () => {
    expect(
      classifyCustomerIoProfile(
        {
          email: "shared@example.com",
          internalUserId: "u-2",
          workshopId: "w-1",
        },
        {
          email: "shared@example.com",
          id: "u-1",
          workshop_id: "w-1",
        },
      ),
    ).toEqual({
      customerIoInternalUserId: "u-1",
      customerIoWorkshopId: "w-1",
      kind: "workshop_match",
      workshopBucketAllowed: true,
    });
  });

  it("rejects email-only Customer.io contacts as non-product contacts", () => {
    expect(
      classifyCustomerIoProfile(
        {
          email: "lead@example.com",
          internalUserId: "u-1",
          workshopId: "w-1",
        },
        {
          email: "lead@example.com",
          first_name: "Newsletter",
        },
      ),
    ).toEqual({
      customerIoInternalUserId: null,
      customerIoWorkshopId: null,
      kind: "non_product_contact",
      workshopBucketAllowed: false,
    });
  });

  it("prefers Stripe enrichment for billing identifiers on users", () => {
    const users = buildUserRows(
      [
        {
          email: "owner@example.com",
          user_id: "u-1",
          workshop_id: "w-1",
        },
      ],
      new Map([
        [
          "u-1",
          {
            country: "SE",
            createdAt: null,
            customerIoId: "cio-1",
            customerIoProfileId: "profile-1",
            customerIoWorkshopId: "w-1",
            matchType: "id",
            stripeCustomerId: "cus_customer_io",
            subscriptionStatus: "trialing",
          },
        ],
      ]),
      new Map([
        [
          "u-1",
          {
            customerCreatedAt: "2026-04-05T00:00:00.000Z",
            customerEmail: "owner@example.com",
            customerId: "cus_stripe",
            matchType: "customer_email",
            subscriptionCreatedAt: "2026-04-06T00:00:00.000Z",
            subscriptionCurrentPeriodEnd: "2026-05-06T00:00:00.000Z",
            subscriptionId: "sub_123",
            subscriptionStatus: "active",
          },
        ],
      ]),
    );

    expect(users[0]?.metadata.stripe_customer_id).toBe("cus_stripe");
    expect(users[0]?.metadata.stripe_subscription_id).toBe("sub_123");
    expect(users[0]?.metadata.subscription_status).toBe("active");
    expect(users[0]?.metadata.subscription_status_source).toBe("stripe");
  });

  it("groups workshops and prefers owner-like roles for the workshop owner", () => {
    const workshops = buildWorkshopRows([
      {
        company_name: "North Garage",
        plan_type: "starter",
        user_id: 1,
        user_role: "technician",
        workshop_id: "w-1",
      },
      {
        company_name: "North Garage",
        plan_type: "starter",
        user_id: 2,
        user_role: "owner",
        workshop_id: "w-1",
      },
    ]);

    expect(workshops).toHaveLength(1);
    expect(workshops[0]?.owner_internal_user_id).toBe("2");
    expect(workshops[0]?.metadata.member_count).toBe(2);
  });

  it("rolls Customer.io workshop enrichment up to the workshop record", () => {
    const workshops = buildWorkshopRows(
      [
        {
          company_name: "North Garage",
          user_id: 2,
          user_role: "owner",
          workshop_id: "w-1",
        },
      ],
      new Map([
        [
          "w-1",
          {
            country: "SE",
            countryConflict: false,
            matchedUsers: 1,
            stripeCustomerId: "cus_123",
            stripeCustomerIdConflict: false,
            subscriptionStatus: "active",
            subscriptionStatusConflict: false,
          },
        ],
      ]),
    );

    expect(workshops[0]?.country).toBeNull();
    expect(workshops[0]?.metadata.customer_io_country).toBe("SE");
    expect(workshops[0]?.metadata.customer_io_subscription_status).toBe(
      "active",
    );
    expect(workshops[0]?.metadata.customer_io_stripe_customer_id).toBe(
      "cus_123",
    );
    expect(workshops[0]?.metadata.subscription_status).toBeNull();
    expect(workshops[0]?.metadata.stripe_customer_id).toBeNull();
    expect(workshops[0]?.metadata.customer_io_matched_users).toBe(1);
  });

  it("prefers Stripe enrichment for workshop billing state", () => {
    const workshops = buildWorkshopRows(
      [
        {
          company_name: "North Garage",
          user_id: 2,
          user_role: "owner",
          workshop_id: "w-1",
        },
      ],
      new Map([
        [
          "w-1",
          {
            country: "SE",
            countryConflict: false,
            matchedUsers: 1,
            stripeCustomerId: "cus_customer_io",
            stripeCustomerIdConflict: false,
            subscriptionStatus: "trialing",
            subscriptionStatusConflict: false,
          },
        ],
      ]),
      new Map([
        [
          "w-1",
          {
            customerCreatedAt: "2026-04-05T00:00:00.000Z",
            customerEmail: "owner@example.com",
            customerId: "cus_stripe",
            matchType: "subscription_metadata",
            subscriptionCreatedAt: "2026-04-06T00:00:00.000Z",
            subscriptionCurrentPeriodEnd: "2026-05-06T00:00:00.000Z",
            subscriptionId: "sub_123",
            subscriptionStatus: "active",
          },
        ],
      ]),
    );

    expect(workshops[0]?.metadata.stripe_customer_id).toBe("cus_stripe");
    expect(workshops[0]?.metadata.stripe_subscription_id).toBe("sub_123");
    expect(workshops[0]?.metadata.subscription_status).toBe("active");
    expect(workshops[0]?.metadata.subscription_status_source).toBe("stripe");
  });

  it("derives workshop ids for diagnostics from the user map", () => {
    const diagnostics = buildDiagnosticsRows(
      [
        {
          created_at: "2026-04-20T10:00:00.000Z",
          diagnostics_id: "d-1",
          diag_cost: 1.25,
          user_id: "u-1",
        },
      ],
      new Map([["u-1", "w-1"]]),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.workshop_id).toBe("w-1");
    expect(diagnostics[0]?.diag_cost).toBe(1.25);
  });

  it("flattens numeric cost leaves into reusable entries", () => {
    const leaves = flattenNumericLeaves("diagnostics", {
      by_model: {
        "gemini-2.5-flash": 12.5,
      },
      total_cost: 44.2,
    });

    expect(leaves).toEqual([
      {
        amount: 12.5,
        itemKey: "by_model.gemini-2.5-flash",
        section: "diagnostics",
      },
      {
        amount: 44.2,
        itemKey: "total_cost",
        section: "diagnostics",
      },
    ]);
  });

  it("builds stable cost entry ids from flattened snapshots", () => {
    const rows = buildCostEntryRows(
      {
        combined: {
          total_cost: 99.5,
        },
      },
      new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost_entry_id).toBe("combined:total_cost");
    expect(rows[0]?.unit).toBe("currency");
  });

  it("aggregates duplicate metric keys before writing snapshots", () => {
    const rows = aggregateMetricPoints([
      {
        sourceKey: "core_app",
        metricKey: "core_diagnostics_created",
        periodStart: new Date("2026-04-24T00:00:00.000Z"),
        periodEnd: new Date("2026-04-25T00:00:00.000Z"),
        value: 1,
      },
      {
        sourceKey: "core_app",
        metricKey: "core_diagnostics_created",
        periodStart: new Date("2026-04-24T00:00:00.000Z"),
        periodEnd: new Date("2026-04-25T00:00:00.000Z"),
        value: 3,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(4);
  });
});
