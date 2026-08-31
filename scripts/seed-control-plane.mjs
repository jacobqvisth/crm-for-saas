// Seed and re-sync the control-plane database.
//
// WHY THIS EXISTS
// ---------------
// `src/config/features.ts` is the single definition of what a feature is. The
// control-plane `features` table is a PROJECTION of it, so the console can
// render names and categories without importing app code.
//
// Two copies of anything drift, so the copy is generated rather than typed.
// Re-run this after adding a feature to the registry. Editing rows by hand is
// how the console ends up offering a toggle for something the code no longer
// knows about.
//
// It also ensures a `tenants` row exists for each known tenant slug. It never
// writes overrides: a tenant with no rows in `tenant_features` inherits every
// default, which is exactly right for a new customer.
//
// SAFETY
// ------
// Dry-run by default. `--apply` is required to write. It refuses to run against
// anything but the control-plane credentials, so it can never be pointed at a
// customer's CRM by a copied environment variable.
//
// Usage:
//   node scripts/seed-control-plane.mjs             # show what would change
//   node scripts/seed-control-plane.mjs --apply
//
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

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
  console.error(
    "Set CONTROL_PLANE_SUPABASE_URL and CONTROL_PLANE_SERVICE_ROLE_KEY.\n" +
      "These are the CONTROL-PLANE project's credentials, deliberately named\n" +
      "differently from the tenant app's so the two can never be confused.",
  );
  process.exit(1);
}

// Guard against the one mistake that would matter: pointing this at a tenant
// database. A CRM project has a `contacts` table; the control plane must not.
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
{
  const { error } = await db.from("contacts").select("id").limit(1);
  const looksLikeCrm = !error;
  if (looksLikeCrm) {
    console.error(
      "REFUSING TO RUN: this database has a `contacts` table, so it is a tenant\n" +
        "CRM, not the control plane. Check CONTROL_PLANE_SUPABASE_URL.",
    );
    process.exit(1);
  }
}

// --- the registry, parsed out of the TypeScript source ----------------------
// Read rather than imported: this is a plain .mjs script and the registry is a
// .ts module. The shape is stable and fully checked by
// src/config/features.test.ts, so a regex is honest here.
const src = readFileSync(join(ROOT, "src", "config", "features.ts"), "utf8");
const entries = [...src.matchAll(/\{\s*key:\s*"([a-z_]+)",\s*name:\s*"([^"]+)",\s*category:\s*"([a-z]+)",\s*description:\s*\n?\s*"((?:[^"\\]|\\.)*)",\s*enabledByDefault:\s*(true|false),/g)];

if (entries.length === 0) {
  console.error("Parsed zero features out of src/config/features.ts. Aborting rather than wiping the table.");
  process.exit(1);
}

const features = entries.map((m) => ({
  key: m[1],
  name: m[2],
  category: m[3],
  description: m[4].replace(/\\"/g, '"'),
  default_enabled: m[5] === "true",
}));

// --- tenants ----------------------------------------------------------------
// Only Wrenchlane today. Animech and Spennare arrive in phases 08 and 09 with
// real values; inventing rows for them now would be guessing.
// The tenants this control plane knows about.
//
// A row here is only a BOOTSTRAP. Once a tenant exists, the console owns its
// status, release channel and notes — see the insert below, which deliberately
// does not overwrite an existing row.
//
// Animech and Spennare are `provisioning`: they are real customers with no
// deployment yet. Listing them now is the point of a control plane. Their
// feature set can be decided, and their overrides recorded, before either has a
// database — and the day they are stood up they pull a config that is already
// correct rather than one assembled in a hurry.
const TENANTS = [
  {
    slug: "wrenchlane",
    display_name: "Wrenchlane",
    status: "active",
    release_channel: "stable",
    supabase_project_ref: "wdgiwuhehqpkhpvdzzzl",
    app_url: "https://crm-for-saas.vercel.app",
  },
  {
    slug: "animech",
    display_name: "Animech",
    status: "provisioning",
    release_channel: "stable",
    supabase_project_ref: null,
    app_url: null,
    notes: "Microsoft 365. No deployment yet.",
  },
  {
    slug: "spennare",
    display_name: "Spennare",
    status: "provisioning",
    release_channel: "stable",
    supabase_project_ref: null,
    app_url: null,
    notes: "Microsoft 365. No deployment yet.",
  },
];

console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
console.log(`Features parsed from the registry: ${features.length}`);
for (const f of features) console.log(`  ${f.key.padEnd(20)} ${f.name}`);
console.log(`Tenants: ${TENANTS.map((t) => t.slug).join(", ")}\n`);

if (!APPLY) {
  const { data: existing } = await db.from("features").select("key");
  const have = new Set((existing ?? []).map((r) => r.key));
  const want = features.map((f) => f.key);
  const missing = want.filter((k) => !have.has(k));
  const extra = [...have].filter((k) => !want.includes(k));

  console.log(`Control plane currently holds ${existing?.length ?? 0} feature rows.`);

  // Name the drift rather than leaving two counts to be compared by eye.
  //
  // A missing row is invisible from the outside: /api/config resolves against
  // the FEATURES constant, not this table, so the endpoint keeps answering
  // correctly while the console renders one toggle fewer and the feature
  // cannot be switched on for any tenant. That happened once already, with
  // linkedin_steps, and went unnoticed because the endpoint looked fine.
  if (missing.length || extra.length) {
    console.log("\nDRIFT between the registry and the control plane:");
    if (missing.length) {
      console.log(`  MISSING from the table (console cannot toggle these): ${missing.join(", ")}`);
    }
    if (extra.length) {
      console.log(`  in the table but no longer in the registry: ${extra.join(", ")}`);
    }
    console.log("\nRe-run with --apply to fix.");
  } else {
    console.log("No drift: the table matches the registry.");
    console.log("Re-run with --apply to rewrite anyway.");
  }
  process.exit(0);
}

{
  const { error } = await db
    .from("features")
    .upsert(features.map((f) => ({ ...f, synced_at: new Date().toISOString() })), {
      onConflict: "key",
    });
  if (error) {
    console.error("features upsert failed:", error.message);
    process.exit(1);
  }
  console.log(`features: ${features.length} upserted`);
}

{
  // INSERT-IF-ABSENT, not upsert.
  //
  // A plain upsert rewrote every column on every run, so suspending a tenant in
  // the console and then re-seeding — which is now a routine step whenever a
  // feature is added — silently set it back to active. Status, release channel
  // and notes are operator state; this script only bootstraps a row that does
  // not exist yet.
  const { data: before } = await db.from("tenants").select("slug");
  const had = new Set((before ?? []).map((r) => r.slug));

  const { error } = await db
    .from("tenants")
    .upsert(TENANTS, { onConflict: "slug", ignoreDuplicates: true });
  if (error) {
    console.error("tenants insert failed:", error.message);
    process.exit(1);
  }

  const added = TENANTS.filter((t) => !had.has(t.slug)).map((t) => t.slug);
  const kept = TENANTS.filter((t) => had.has(t.slug)).map((t) => t.slug);
  console.log(`tenants: ${added.length} added${added.length ? ` (${added.join(", ")})` : ""}`);
  if (kept.length) console.log(`         ${kept.length} left untouched (${kept.join(", ")})`);
}

// A feature removed from the registry keeps its row, deliberately: deleting it
// would cascade away every tenant's override and silently re-enable things.
// Report the drift instead and let a human decide.
{
  const { data: rows } = await db.from("features").select("key");
  const known = new Set(features.map((f) => f.key));
  const orphans = (rows ?? []).map((r) => r.key).filter((k) => !known.has(k));
  if (orphans.length) {
    console.log(`\nNOTE: ${orphans.length} row(s) in the control plane are no longer in the registry:`);
    for (const o of orphans) console.log(`  ${o}`);
    console.log("Left in place on purpose — deleting them cascades away tenant overrides.");
  }
}

console.log("\nDone.");
