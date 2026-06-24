/**
 * Unit tests for resolveVariables() — covers plain {{var}}, TipTap span-wrapped
 * variables, and missing/unknown variables. Also covers ensureUnsubscribeLink.
 *
 * Originally written as bare top-level `console.log` + manual `assert()`
 * calls. Vitest's discovery layer then flagged the file as "no test suite
 * found" on every CI run (1 spurious FAIL even though all assertions
 * passed) because nothing was inside a `describe`/`it` block. Converted
 * to the standard framework shape so the failed-suite line is gone.
 */

import { describe, expect, it } from "vitest";

import { resolveVariables, ensureUnsubscribeLink } from "../variables";
import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------
const contact = {
  id: "c1",
  workspace_id: "ws1",
  email: "jane@example.com",
  first_name: "Jane",
  last_name: "Smith",
  phone: "+46 70 123 45 67",
  title: null,
  city: null,
  country: null,
  country_code: null,
  address: null,
  postal_code: null,
  company_id: "co1",
  is_primary: false,
  status: "active" as const,
  lead_status: "new" as const,
  source: null,
  email_status: "verified",
  email_verified_at: null,
  seniority: null,
  signed_up_at: null,
  linkedin_url: null,
  instagram_url: null,
  facebook_url: null,
  all_emails: [] as string[],
  all_phones: [] as string[],
  language: null,
  tags: [] as string[],
  notes: null,
  last_contacted_at: null,
  last_emailed_at: null,
  custom_fields: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  // wl-app fields (null defaults for non-app-user contacts)
  wl_user_id: null,
  app_username: null,
  app_role: null,
  last_login_at: null,
  last_active_at: null,
  last_visited_at: null,
  login_count: null,
  credits_remaining: null,
  user_plan_type: null,
  user_subscription_status: null,
  user_stripe_customer_id: null,
  user_stripe_subscription_id: null,
  diagnostics_total: null,
  diagnostics_first_at: null,
  diagnostics_last_at: null,
  diagnostics_last_30d: null,
  attributed_to_send_id: null,
  attributed_to_sequence_id: null,
  attributed_via: null,
  attributed_at: null,
  website: null,
} satisfies Contact;

const company: Company = {
  id: "co1",
  workspace_id: "ws1",
  name: "Test Garage",
  diagnostics_total: null,
  diagnostics_first_at: null,
  diagnostics_last_at: null,
  diagnostics_last_30d: null,
  domain: null,
  website: null,
  phone: null,
  address: null,
  city: null,
  postal_code: null,
  country: null,
  country_code: null,
  industry: null,
  category: null,
  description: null,
  employee_count: null,
  annual_revenue: null,
  revenue_range: null,
  founded_year: null,
  linkedin_url: null,
  instagram_url: null,
  facebook_url: null,
  google_place_id: null,
  rating: null,
  review_count: null,
  tech_stack: [],
  parent_company_id: null,
  tags: [],
  notes: null,
  custom_fields: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  // workshop/customer fields (null defaults for non-customer companies)
  source: null,
  wl_workshop_id: null,
  lifecycle_stage: null,
  customer_status: null,
  plan: null,
  plan_billing_cycle: null,
  mrr_cents: null,
  arr_cents: null,
  currency: null,
  trial_ends_at: null,
  activated_at: null,
  churned_at: null,
  churn_reason: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_status: null,
  payment_status: null,
  acquisition_source: null,
  created_by_agent: null,
  account_owner_id: null,
  member_count: null,
  last_active_at: null,
  last_visited_at: null,
  health_score: null,
  latitude: null,
  longitude: null,
  geocoded_at: null,
  skip_auto_followup: false,
  do_not_contact: false,
  do_not_route: false,
  do_not_route_reason: null,
  do_not_route_at: null,
  min_revisit_interval_days: null,
  org_number: null,
  cfar_number: null,
  marketing_opt_out: false,
  nix_blocked: false,
  is_sole_proprietor: false,
  employee_size_band: null,
  county: null,
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function run(
  template: string,
  c: Contact = contact,
  co: Company | null = company,
  trackingId = "track-123",
) {
  return resolveVariables(template, c, co, trackingId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("resolveVariables — bare {{variable}} patterns", () => {
  it("replaces {{first_name}}", () => {
    expect(run("Hi {{first_name}},")).toBe("Hi Jane,");
  });

  it("replaces {{last_name}}", () => {
    expect(run("{{last_name}}")).toBe("Smith");
  });

  it("replaces {{email}}", () => {
    expect(run("{{email}}")).toBe("jane@example.com");
  });

  it("replaces {{company_name}}", () => {
    expect(run("{{company_name}}")).toBe("Test Garage");
  });

  it("replaces {{phone}}", () => {
    expect(run("{{phone}}")).toBe("+46 70 123 45 67");
  });

  it("replaces {{unsubscribe_link}} with the tracking URL", () => {
    expect(run("{{unsubscribe_link}}")).toContain(
      "/api/tracking/unsubscribe/track-123",
    );
  });

  it("turns unknown variables into the empty string", () => {
    expect(run("{{unknown_var}}")).toBe("");
  });

  it("falls back to 'there' when first_name is missing", () => {
    expect(run("Hi {{first_name}},", { ...contact, first_name: null })).toBe(
      "Hi there,",
    );
  });

  it("renders {{first_name_optional}} as a space-prefixed name when present", () => {
    expect(run("Hi{{first_name_optional}},")).toBe("Hi Jane,");
  });

  it("renders {{first_name_optional}} as empty when first_name is missing", () => {
    expect(
      run("Hi{{first_name_optional}},", { ...contact, first_name: null }),
    ).toBe("Hi,");
  });

  it("renders {{first_name_optional}} as empty when first_name is an empty string", () => {
    expect(
      run("Hi{{first_name_optional}},", { ...contact, first_name: "" }),
    ).toBe("Hi,");
  });

  it("falls back to 'your company' when no company is provided", () => {
    expect(run("{{company_name}}", contact, null)).toBe("your company");
  });
});

describe("resolveVariables — TipTap <span data-variable> patterns", () => {
  it("replaces span-wrapped first_name", () => {
    const tpl = `<p>Hi <span data-variable="first_name">{{first_name}}</span>,</p>`;
    expect(run(tpl)).toBe("<p>Hi Jane,</p>");
  });

  it("replaces span-wrapped company_name", () => {
    const tpl = `<span data-variable="company_name">{{company_name}}</span>`;
    expect(run(tpl)).toBe("Test Garage");
  });

  it("replaces span-wrapped unsubscribe_link", () => {
    const tpl = `<a href=""><span data-variable="unsubscribe_link">{{unsubscribe_link}}</span></a>`;
    expect(run(tpl)).toContain("/api/tracking/unsubscribe/track-123");
  });

  it("turns unknown span variables into the empty string", () => {
    const tpl = `<span data-variable="mystery_field">{{mystery_field}}</span>`;
    expect(run(tpl)).toBe("");
  });

  it("still resolves correctly when the span uses a human-readable label", () => {
    // Legacy format — the inner text was "First name" instead of {{first_name}}.
    const tpl = `<span data-variable="first_name">First name</span>`;
    expect(run(tpl)).toBe("Jane");
  });
});

describe("resolveVariables — mixed span + bare patterns in one template", () => {
  it("resolves both span and bare vars in one pass", () => {
    const mixed = `<p>Hi <span data-variable="first_name">{{first_name}}</span>, thanks for reaching out. Your company {{company_name}} is interesting.</p>`;
    expect(run(mixed)).toBe(
      "<p>Hi Jane, thanks for reaching out. Your company Test Garage is interesting.</p>",
    );
  });
});

describe("ensureUnsubscribeLink — now a passthrough (List-Unsubscribe header handles compliance)", () => {
  it("returns bodies with an explicit link unchanged", () => {
    const body = `<p>Hello</p><a href="/api/tracking/unsubscribe/abc">Unsub</a>`;
    expect(ensureUnsubscribeLink(body, "new-id")).toBe(body);
  });

  it("returns bodies with an explicit span variable unchanged", () => {
    const body = `<p>Hello</p><span data-variable="unsubscribe_link">{{unsubscribe_link}}</span>`;
    expect(ensureUnsubscribeLink(body, "new-id")).toBe(body);
  });

  it("no longer injects a visible footer when one isn't present", () => {
    const body = `<p>Hello Jane</p>`;
    expect(ensureUnsubscribeLink(body, "track-xyz")).toBe(body);
  });

  it("leaves no raw {{unsubscribe_link}} placeholder after resolve+ensure", () => {
    const out = resolveVariables(
      ensureUnsubscribeLink("<p>Hi</p>", "tid-abc"),
      contact,
      company,
      "tid-abc",
    );
    expect(out).not.toContain("{{unsubscribe_link}}");
  });
});
