/**
 * Unit tests for resolveVariables() — covers plain {{var}}, TipTap span-wrapped
 * variables, and missing/unknown variables.
 *
 * Run with: npx tsx --test src/lib/sequences/__tests__/variable-interpolation.test.ts
 * (or integrate into your preferred test runner)
 */

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
  linkedin_url: null,
  instagram_url: null,
  facebook_url: null,
  all_emails: [] as string[],
  all_phones: [] as string[],
  language: null,
  tags: [] as string[],
  notes: null,
  last_contacted_at: null,
  custom_fields: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} satisfies Contact;

const company: Company = {
  id: "co1",
  workspace_id: "ws1",
  name: "Test Garage",
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function run(
  template: string,
  c: Contact = contact,
  co: Company | null = company,
  trackingId = "track-123"
) {
  return resolveVariables(template, c, co, trackingId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(description: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertContains(description: string, actual: string, substring: string) {
  if (actual.includes(substring)) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`    Expected to contain: ${JSON.stringify(substring)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertNotContains(description: string, actual: string, substring: string) {
  if (!actual.includes(substring)) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`    Expected NOT to contain: ${JSON.stringify(substring)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Suite 1: Plain {{var}} — backward compat
// ---------------------------------------------------------------------------
console.log("\n── Bare {{variable}} patterns ──────────────────────────────");

assert(
  "replaces {{first_name}}",
  run("Hi {{first_name}},"),
  "Hi Jane,"
);

assert(
  "replaces {{last_name}}",
  run("{{last_name}}"),
  "Smith"
);

assert(
  "replaces {{email}}",
  run("{{email}}"),
  "jane@example.com"
);

assert(
  "replaces {{company_name}}",
  run("{{company_name}}"),
  "Test Garage"
);

assert(
  "replaces {{phone}}",
  run("{{phone}}"),
  "+46 70 123 45 67"
);

assertContains(
  "replaces {{unsubscribe_link}} with tracking URL",
  run("{{unsubscribe_link}}"),
  "/api/tracking/unsubscribe/track-123"
);

assert(
  "unknown variable becomes empty string",
  run("{{unknown_var}}"),
  ""
);

assert(
  "missing first_name falls back to 'there'",
  run("Hi {{first_name}},", { ...contact, first_name: null }),
  "Hi there,"
);

assert(
  "missing company falls back to 'your company'",
  run("{{company_name}}", contact, null),
  "your company"
);

// ---------------------------------------------------------------------------
// Suite 2: TipTap span-wrapped variables
// ---------------------------------------------------------------------------
console.log("\n── TipTap <span data-variable> patterns ────────────────────");

const spanFirst = `<p>Hi <span data-variable="first_name">{{first_name}}</span>,</p>`;
assert(
  "replaces span-wrapped first_name",
  run(spanFirst),
  "<p>Hi Jane,</p>"
);

const spanCompany = `<span data-variable="company_name">{{company_name}}</span>`;
assert(
  "replaces span-wrapped company_name",
  run(spanCompany),
  "Test Garage"
);

const spanUnsubscribe = `<a href=""><span data-variable="unsubscribe_link">{{unsubscribe_link}}</span></a>`;
assertContains(
  "replaces span-wrapped unsubscribe_link",
  run(spanUnsubscribe),
  "/api/tracking/unsubscribe/track-123"
);

const spanUnknown = `<span data-variable="mystery_field">{{mystery_field}}</span>`;
assert(
  "unknown span variable becomes empty string",
  run(spanUnknown),
  ""
);

// Span with human-readable label (legacy format)
const spanLegacy = `<span data-variable="first_name">First name</span>`;
assert(
  "span with human-readable label inner text still resolves correctly",
  run(spanLegacy),
  "Jane"
);

// ---------------------------------------------------------------------------
// Suite 3: Mixed — spans and bare vars in same template
// ---------------------------------------------------------------------------
console.log("\n── Mixed span + bare patterns ───────────────────────────────");

const mixed = `<p>Hi <span data-variable="first_name">{{first_name}}</span>, thanks for reaching out. Your company {{company_name}} is interesting.</p>`;
assert(
  "resolves both span and bare vars in one pass",
  run(mixed),
  "<p>Hi Jane, thanks for reaching out. Your company Test Garage is interesting.</p>"
);

// ---------------------------------------------------------------------------
// Suite 4: ensureUnsubscribeLink
// ---------------------------------------------------------------------------
console.log("\n── ensureUnsubscribeLink ─────────────────────────────────────");

const bodyWithLink = `<p>Hello</p><a href="/api/tracking/unsubscribe/abc">Unsub</a>`;
assert(
  "does not add second unsubscribe if already present",
  ensureUnsubscribeLink(bodyWithLink, "new-id"),
  bodyWithLink
);

const bodyWithSpanVar = `<p>Hello</p><span data-variable="unsubscribe_link">{{unsubscribe_link}}</span>`;
assert(
  "does not add unsubscribe if span variable is present",
  ensureUnsubscribeLink(bodyWithSpanVar, "new-id"),
  bodyWithSpanVar
);

const bodyNoLink = `<p>Hello Jane</p>`;
assertContains(
  "appends unsubscribe footer when none exists",
  ensureUnsubscribeLink(bodyNoLink, "track-xyz"),
  "/api/tracking/unsubscribe/track-xyz"
);

assertNotContains(
  "raw {{unsubscribe_link}} placeholder does not remain after resolve+ensure",
  resolveVariables(
    ensureUnsubscribeLink("<p>Hi</p>", "tid-abc"),
    contact,
    company,
    "tid-abc"
  ),
  "{{unsubscribe_link}}"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
