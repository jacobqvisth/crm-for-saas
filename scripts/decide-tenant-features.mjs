// Decide a new tenant's twenty feature flags, deliberately, with reasons.
//
// WHY THIS EXISTS
// ---------------
// Ground rule R2 says flags default ON so Wrenchlane never silently loses a
// feature, and then: "New tenants get a config that switches things off;
// Wrenchlane's config is the baseline."
//
// The second half had never been done. Nineteen of the twenty features default
// on, and most of them are Wrenchlane's: as it stood, Animech and Spennare
// would have inherited DTC fault-code dashboards, a fault-code YouTube gallery,
// Reddit car-forum answering, app-store review collection and a voice call
// agent. A 3D configurator company and a signage company, given a car
// diagnostics product.
//
// The fix is NOT to flip the registry defaults. That takes features away from
// Wrenchlane and breaks the first half of R2. It is per-tenant overrides in the
// control plane, which is exactly what the control plane is for.
//
// WHY EVERY KEY IS WRITTEN, EVEN THE ONES THAT MATCH THE DEFAULT
// -------------------------------------------------------------
// An absent row means "inheriting". That is a real and useful state, but the
// phase 11 brief asks for every flag to have been "decided deliberately rather
// than inherited, and the reasons in the audit log". A row with a note is the
// difference between a feature being off because someone chose that and it
// being off by accident. In six months "why is Forums off for Animech" should
// be answerable from the console, and this is what makes it answerable.
//
// SAFETY
// ------
// Dry-run by default; `--apply` writes. It REFUSES to write Wrenchlane's flags
// at all. Wrenchlane is the live business and the baseline (R1, R2), and a
// session has already once put `forums: false` into its production config from
// a local run. A guard is cheaper than remembering.
//
// Usage:
//   node scripts/decide-tenant-features.mjs                 # dry run, all new tenants
//   node scripts/decide-tenant-features.mjs --tenant=animech
//   node scripts/decide-tenant-features.mjs --apply
//
// Needs CONTROL_PLANE_SUPABASE_URL and CONTROL_PLANE_SERVICE_ROLE_KEY. Those are
// the CONTROL-PLANE project's, deliberately named differently from the tenant
// app's so the two can never be confused.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--tenant="))?.slice(9);

/** Recorded as the actor. Honest: nobody clicked twenty toggles. */
const ACTOR = "phase-11-tenant-bring-up";

// --- the decisions -----------------------------------------------------------
//
// Grounded in what these two companies actually sell:
//
//   Animech   3D configurators and CPQ for manufacturers (Volkswagen, SKF,
//             Cytiva, Fjallraven). ~40 people, Uppsala. Enterprise consultative
//             sales into a buying committee. Microsoft 365.
//   Spennare  Portable exhibition and signage systems, sold through resellers
//             in 50+ countries. Reseller/dealer motion, international.
//
// Note what is NOT in this list: contacts, companies, sequences, lists, inbox,
// tasks, templates and settings are not feature-gated at all. Switching
// eighteen of these twenty off does not leave a stub, it leaves a clean CRM.

const CAR = "Wrenchlane's car-diagnostics content. Meaningless for this customer's market.";
const PRODUCT_ANALYTICS =
  "Part of the product-analytics suite, which assumes a self-serve SaaS with its " +
  "own signup funnel plus our access to its Stripe, GA4 and PostHog. This customer " +
  "does not sell that way.";
const INTERNAL = "Internal to Jacob's own planning, not a customer-facing feature.";
const NOT_BUILT_YET =
  "Planned but not shipped. Switching it on would put a nav item in front of routes " +
  "that do not exist. Revisit when that phase lands.";

/** Shared baseline. Both new tenants agree on all of these. */
const COMMON = {
  dtc: [false, CAR],
  videos: [false, CAR],
  forums: [
    false,
    "Answers car-forum and Reddit threads about fault codes. Wrong audience, and " +
      "it spends Apify credits per scan.",
  ],
  reviews: [
    false,
    "Collects app-store and public review-site ratings. This customer has no " +
      "consumer app to collect them from.",
  ],
  field_routes: [
    false,
    "Route-optimised driving between many small local sites. Wrong shape for both " +
      "an enterprise account list and an international reseller network.",
  ],
  calling: [
    false,
    "Needs 46elks telephony, which this customer has not bought. Turn on together " +
      "with integrations.elks when they do.",
  ],
  call_agent: [
    false,
    "A voice agent for high-volume, low-value calling. Wrong for consultative sales, " +
      "and it needs ElevenLabs credentials they do not have.",
  ],
  product_analytics: [false, PRODUCT_ANALYTICS],
  journey: [false, PRODUCT_ANALYTICS],
  funnel: [false, PRODUCT_ANALYTICS],
  activation: [false, PRODUCT_ANALYTICS],
  pricing_options: [false, PRODUCT_ANALYTICS],
  roadmap: [false, INTERNAL],
  mockup: [false, "Internal. Embeds one specific Wrenchlane prototype."],
  deals: [false, NOT_BUILT_YET + " Phase 10A."],
  linkedin_steps: [
    false,
    "Already off by default. Recorded explicitly so it reads as a decision: it is " +
      "useless until contacts actually have linkedin_url populated, which no tenant " +
      "does yet.",
  ],
  articles: [
    true,
    "The one content feature that is not car-specific. Drafting works immediately; " +
      "publishing needs this customer's own Webflow token.",
  ],
  domain_portfolio: [
    true,
    "Any customer sending outbound wants its sending domains watched. Generic and " +
      "cheap to leave on.",
  ],
};

const DECISIONS = {
  animech: {
    ...COMMON,
    discovery: [
      false,
      "Apify Google Maps discovery. Checked against Animech's actual market: their " +
        "buyers are manufacturers reached through named accounts, and Maps discovery " +
        "does not find them. Leaving it on would produce a scraper full of noise.",
    ],
    dealer_network: [
      false,
      NOT_BUILT_YET + " Phase 10C, and it is designed for Spennare's reseller " +
        "network rather than Animech's direct enterprise motion.",
    ],
  },

  spennare: {
    ...COMMON,
    discovery: [
      true,
      "Apify Google Maps discovery works for Spennare's market: exhibition and signage " +
        "resellers are listed businesses with addresses. This is the one feature the " +
        "two new tenants differ on.",
    ],
    dealer_network: [
      false,
      NOT_BUILT_YET + " Phase 10C. Spennare is the customer it is being built FOR, so " +
        "this is the row to flip first when it ships.",
    ],
  },
};

// --- connect -----------------------------------------------------------------
function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = loadEnvLocal();
const env = (k) => process.env[k] ?? fileEnv[k];

const URL_ = env("CONTROL_PLANE_SUPABASE_URL");
const KEY = env("CONTROL_PLANE_SERVICE_ROLE_KEY");
if (!URL_ || !KEY) {
  console.error("Set CONTROL_PLANE_SUPABASE_URL and CONTROL_PLANE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false } });

// Same guard as seed-control-plane.mjs: a CRM has `contacts`, the control plane
// must not.
{
  const { error } = await db.from("contacts").select("id").limit(1);
  if (!error) {
    console.error(
      "REFUSING TO RUN: this database has a `contacts` table, so it is a tenant CRM,\n" +
        "not the control plane. Check CONTROL_PLANE_SUPABASE_URL.",
    );
    process.exit(1);
  }
}

// --- validate against the registry ------------------------------------------
const { data: features, error: fErr } = await db
  .from("features")
  .select("key, default_enabled");
if (fErr) {
  console.error("Could not read the features table:", fErr.message);
  process.exit(1);
}
const registryKeys = new Set(features.map((f) => f.key));
const defaults = new Map(features.map((f) => [f.key, f.default_enabled]));

for (const [slug, decisions] of Object.entries(DECISIONS)) {
  const decided = new Set(Object.keys(decisions));
  const missing = [...registryKeys].filter((k) => !decided.has(k));
  const unknown = [...decided].filter((k) => !registryKeys.has(k));
  if (unknown.length) {
    console.error(
      `${slug}: decisions for feature(s) the control plane does not know: ${unknown.join(", ")}.\n` +
        `Run scripts/seed-control-plane.mjs --apply first.`,
    );
    process.exit(1);
  }
  if (missing.length) {
    console.error(
      `${slug}: no decision recorded for ${missing.length} feature(s): ${missing.join(", ")}.\n` +
        `Every flag has to be decided deliberately. Add them to DECISIONS.`,
    );
    process.exit(1);
  }
}

// --- apply -------------------------------------------------------------------
const { data: tenants, error: tErr } = await db.from("tenants").select("id, slug");
if (tErr) {
  console.error("Could not read tenants:", tErr.message);
  process.exit(1);
}

console.log(APPLY ? "MODE: APPLY\n" : "MODE: DRY RUN (pass --apply to write)\n");

for (const [slug, decisions] of Object.entries(DECISIONS)) {
  if (ONLY && slug !== ONLY) continue;

  // The guard that matters most in this whole file.
  if (slug === "wrenchlane") {
    console.error("REFUSING: Wrenchlane's flags are the baseline and are not written here.");
    process.exit(1);
  }

  const tenant = tenants.find((t) => t.slug === slug);
  if (!tenant) {
    console.error(`No tenant row for "${slug}". Run scripts/seed-control-plane.mjs first.`);
    process.exit(1);
  }

  const { data: existing } = await db
    .from("tenant_features")
    .select("feature_key, enabled")
    .eq("tenant_id", tenant.id);
  const before = new Map((existing ?? []).map((r) => [r.feature_key, r.enabled]));

  const rows = Object.entries(decisions).map(([key, [enabled, note]]) => ({
    tenant_id: tenant.id,
    feature_key: key,
    enabled,
    note,
    updated_by: ACTOR,
    updated_at: new Date().toISOString(),
  }));

  const on = rows.filter((r) => r.enabled).map((r) => r.feature_key);
  const off = rows.filter((r) => !r.enabled).map((r) => r.feature_key);
  const changes = rows.filter(
    (r) => before.get(r.feature_key) !== r.enabled,
  ).length;

  console.log(`${slug}: ${rows.length} decisions, ${changes} differ from what is stored`);
  console.log(`  ON  (${on.length}): ${on.join(", ") || "-"}`);
  console.log(`  OFF (${off.length}): ${off.join(", ")}`);
  const silent = rows.filter(
    (r) => defaults.get(r.feature_key) !== r.enabled,
  ).length;
  console.log(
    `  ${silent} of these differ from the registry default, i.e. would have been ` +
      `inherited wrongly\n`,
  );

  if (!APPLY) continue;

  const { error: upErr } = await db
    .from("tenant_features")
    .upsert(rows, { onConflict: "tenant_id,feature_key" });
  if (upErr) {
    console.error(`  failed to write ${slug}:`, upErr.message);
    process.exit(1);
  }

  const { error: auditErr } = await db.from("audit_log").insert({
    actor: ACTOR,
    tenant_id: tenant.id,
    action: "decide_tenant_features",
    before: Object.fromEntries(before),
    after: Object.fromEntries(rows.map((r) => [r.feature_key, r.enabled])),
  });
  if (auditErr) {
    console.error(`  wrote flags but FAILED to write the audit entry:`, auditErr.message);
    process.exit(1);
  }
  console.log(`  written, and one audit_log entry appended\n`);
}

console.log(APPLY ? "Done." : "Dry run complete.");
