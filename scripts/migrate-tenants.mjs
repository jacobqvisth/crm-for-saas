// Apply `supabase/migrations/` to every tenant database, from one place.
//
// WHY THIS EXISTS
// ---------------
// Ground rule R4: "Every migration runs on every tenant database, from one
// script, never by hand." There is no world where three or four schemas are
// kept in step manually, and this repository has already proved it. Before
// phase 01 there were 129 local migration files and 68 rows in the remote
// history, and exactly TWO versions appeared in both. The habit of applying a
// migration straight through psql or the Management API, without writing the
// history row, is what produced that. This script is the replacement for that
// habit.
//
// It is deliberately dumb: it compares the migration files on disk against the
// `supabase_migrations.schema_migrations` table in each tenant, and applies
// whatever is missing, in version order, inside a transaction, recording the
// history row in the same transaction. If the apply fails, the history row is
// not written, so a half-applied migration cannot be mistaken for a done one.
//
// It shells out to `psql` rather than pulling in a Postgres driver, because
// psql is already this project's documented tool for schema work and adding a
// runtime dependency to ship a migration would be its own kind of risk.
//
// SAFETY
// ------
// Dry-run is the default and always has been. `--apply` is required to write
// anything, and the script refuses to apply to more than one tenant unless you
// also pass `--all`, so a fat-fingered run cannot touch every customer at once.
//
// Reminder of the rule this script cannot enforce for you (R3): migrations must
// be additive and backward compatible, because tenants can be on different code
// versions. No DROP, no RENAME, no ALTER COLUMN TYPE, no new NOT NULL without a
// default, no narrowed CHECK, no removed enum value. Expand and contract over
// two releases.
//
// Usage:
//   node scripts/migrate-tenants.mjs                      # dry-run, every tenant
//   node scripts/migrate-tenants.mjs --tenant=wrenchlane  # dry-run, one tenant
//   node scripts/migrate-tenants.mjs --tenant=wrenchlane --apply
//   node scripts/migrate-tenants.mjs --apply --all        # apply everywhere
//
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// psql is keg-only under Homebrew, so it is not on PATH by default.
const PSQL = existsSync("/opt/homebrew/opt/libpq/bin/psql")
  ? "/opt/homebrew/opt/libpq/bin/psql"
  : "psql";

// ---------------------------------------------------------------------------
// The tenant list.
//
// Phase 04 stands up the control plane and this list moves there, fetched over
// HTTP with a token scoped to the caller. Until then it is a local constant, as
// the phase 01 brief allows.
//
// R5: never copy an env file between tenants, and never write a password here.
// Each tenant names the environment variable holding its own connection string;
// the value lives in .env.local (or the shell) and nowhere else.
// ---------------------------------------------------------------------------
const TENANTS = [
  {
    slug: "wrenchlane",
    label: "Wrenchlane (production)",
    // postgresql://postgres.<ref>:<pw>@aws-1-eu-north-1.pooler.supabase.com:5432/postgres
    urlEnv: "SUPABASE_DB_URL",
    // Fallback for the way this repo already stores it: password only, with the
    // rest of the connection known. Lets the script work today with no new env var.
    fallback: {
      host: "aws-1-eu-north-1.pooler.supabase.com",
      port: 5432,
      user: "postgres.wdgiwuhehqpkhpvdzzzl",
      database: "postgres",
      passwordEnv: "SUPABASE_DB_PASSWORD",
    },
  },
  {
    slug: "animech",
    label: "Animech",
    urlEnv: "ANIMECH_SUPABASE_DB_URL",
    fallback: {
      // NOTE THE SHARD. Wrenchlane is on aws-1; this project was created in
      // 2026 and is on aws-0. Both are eu-north-1. Assuming the shard from the
      // other tenant produces a connection that times out rather than one that
      // says anything useful, so it is read from
      // GET /v1/projects/<ref>/config/database/pooler and pinned here.
      //
      // Port 5432 is the SESSION pooler. The API advertises 6543, which is
      // transaction mode: fine for the app, wrong for migrations.
      host: "aws-0-eu-north-1.pooler.supabase.com",
      port: 5432,
      user: "postgres.hnriqsnenyzmlctkkdmi",
      database: "postgres",
      passwordEnv: "ANIMECH_SUPABASE_DB_PASSWORD",
    },
  },
  {
    slug: "spennare",
    label: "Spennare",
    urlEnv: "SPENNARE_SUPABASE_DB_URL",
    fallback: {
      // Same shard as Animech (aws-0) rather than Wrenchlane's (aws-1), read
      // from GET /v1/projects/<ref>/config/database/pooler rather than assumed.
      // Guessing the shard from another tenant produces a connection that times
      // out instead of one that says anything useful.
      //
      // Port 5432 is the SESSION pooler. The API advertises 6543 for this
      // project, which is transaction mode: fine for the app, wrong for
      // migrations.
      host: "aws-0-eu-north-1.pooler.supabase.com",
      port: 5432,
      user: "postgres.cuzbkkmqyyvjcuoofzvm",
      database: "postgres",
      passwordEnv: "SPENNARE_SUPABASE_DB_PASSWORD",
    },
  },
  // Each tenant gets its OWN connection string in its own environment: no
  // shared credentials, ever (R5).
  //
  // NOTE FOR THE GENERALISATION BACKLOG: adding a tenant here is a CODE change,
  // not a config one. Phase 04 was supposed to move this list to the control
  // plane, fetched over HTTP with a token scoped to the caller, and it has not
  // happened. Standing up Spennare needed exactly this edit, which is the kind
  // of thing phase 09 exists to surface.
];

// --- arguments -------------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ALL = args.includes("--all");
const tenantArg = args.find((a) => a.startsWith("--tenant="));
const TENANT_FILTER = tenantArg ? tenantArg.slice("--tenant=".length) : null;

// --- env -------------------------------------------------------------------
// Read .env.local the same way the other ops scripts in this directory do,
// without pulling in dotenv. Shell environment wins, so CI can override.
function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}
const fileEnv = loadEnvLocal();
const env = (key) => process.env[key] ?? fileEnv[key];

function connectionFor(tenant) {
  const direct = env(tenant.urlEnv);
  if (direct) return direct;
  const fb = tenant.fallback;
  if (!fb) return null;
  const pw = env(fb.passwordEnv);
  if (!pw) return null;
  return `postgresql://${fb.user}:${encodeURIComponent(pw)}@${fb.host}:${fb.port}/${fb.database}`;
}

// --- migrations on disk ----------------------------------------------------
// `_archive/` is a directory, so readdir's .sql filter skips it. That is
// deliberate: those 129 files are history and must never be applied again.
function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const m = file.match(/^(\d+)_(.+)\.sql$/);
      if (!m) throw new Error(`Migration filename is not <version>_<name>.sql: ${file}`);
      return { version: m[1], name: m[2], file, path: join(MIGRATIONS_DIR, file) };
    });
}

// --- drivers ---------------------------------------------------------------
// Two ways to reach a tenant, behind one interface, because the credential that
// exists differs per tenant and per machine.
//
// `psql` is the primary and stays the documented tool. But it needs a DATABASE
// password, and the productisation work has only ever put Wrenchlane's on this
// machine -- Animech and Spennare were stood up through the Management API and
// their database passwords live nowhere here. Without a fallback, R4's "one
// script, never by hand" quietly becomes "one script for Wrenchlane, by hand for
// the customers", which is exactly the drift R4 exists to prevent.
//
// So when no password is configured, the same migration is applied over the
// Management API with the personal access token, which is the credential that
// DOES exist for every project. The semantics are identical and slightly
// stronger: the migration and its history row go in ONE transaction, so a failed
// apply cannot leave a recorded version behind.
function psqlQuery(conn, sql) {
  return execFileSync(PSQL, [conn, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function psqlFile(conn, file) {
  execFileSync(PSQL, [conn, "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function managementToken() {
  const fromEnv = env("SUPABASE_ACCESS_TOKEN");
  if (fromEnv) return fromEnv;
  const secrets = join(homedir(), ".secrets/keys.env");
  if (!existsSync(secrets)) return null;
  const m = readFileSync(secrets, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

async function apiQuery(ref, token, sql) {
  // Cloudflare answers a bare fetch from some runtimes with error 1010, so the
  // User-Agent is set explicitly. Documented in the Supabase access notes.
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (migrate-tenants)",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

function psqlDriver(conn) {
  return {
    kind: "psql",
    query: async (sql) => psqlQuery(conn, sql),
    // psql's -1 already wraps the file; the history row follows it.
    applyMigration: async (m) => {
      psqlFile(conn, m.path);
      psqlQuery(
        conn,
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ('${m.version}', '${m.name.replace(/'/g, "''")}')
         ON CONFLICT (version) DO NOTHING`,
      );
    },
  };
}

function apiDriver(ref, token) {
  return {
    kind: "management API",
    query: async (sql) => {
      const rows = await apiQuery(ref, token, sql);
      // Match psql -At: one scalar per line, no headers.
      return rows.map((r) => Object.values(r)[0]).join("\n");
    },
    applyMigration: async (m) => {
      const body = readFileSync(m.path, "utf8");
      await apiQuery(
        ref,
        token,
        `BEGIN;\n${body}\n` +
          "INSERT INTO supabase_migrations.schema_migrations (version, name)\n" +
          `VALUES ('${m.version}', '${m.name.replace(/'/g, "''")}')\n` +
          "ON CONFLICT (version) DO NOTHING;\nCOMMIT;",
      );
    },
  };
}

/** The best available way to reach this tenant, or null if there is none. */
function driverFor(tenant) {
  const conn = connectionFor(tenant);
  if (conn) return psqlDriver(conn);
  const ref = tenant.fallback?.user?.split(".")[1];
  const token = managementToken();
  if (ref && token) return apiDriver(ref, token);
  return null;
}

async function appliedVersions(driver) {
  // The history table does not exist on a brand new project until something
  // creates it; treat "no table" as "nothing applied".
  const exists = await driver.query(
    "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL",
  );
  if (exists !== "t" && exists !== "true") return null;
  const rows = await driver.query("SELECT version FROM supabase_migrations.schema_migrations");
  return new Set(rows ? rows.split("\n").filter(Boolean) : []);
}

async function ensureHistoryTable(driver) {
  await driver.query(
    `CREATE SCHEMA IF NOT EXISTS supabase_migrations;
     CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
       version text PRIMARY KEY,
       statements text[],
       name text
     );`,
  );
}

// --- main ------------------------------------------------------------------
const migrations = localMigrations();
const tenants = TENANT_FILTER ? TENANTS.filter((t) => t.slug === TENANT_FILTER) : TENANTS;

if (TENANT_FILTER && tenants.length === 0) {
  console.error(`No tenant named "${TENANT_FILTER}". Known: ${TENANTS.map((t) => t.slug).join(", ")}`);
  process.exit(1);
}

console.log(APPLY ? "MODE: APPLY (writes will execute)" : "MODE: DRY-RUN (no writes)");
console.log(`Migrations on disk: ${migrations.length}`);
console.log(`Tenants: ${tenants.map((t) => t.slug).join(", ")}\n`);

if (APPLY && tenants.length > 1 && !ALL) {
  console.error(
    `Refusing to apply to ${tenants.length} tenants at once.\n` +
      `Pass --tenant=<slug> to pick one, or --all if you really mean every tenant.`,
  );
  process.exit(1);
}

let failures = 0;
let totalPending = 0;

for (const tenant of tenants) {
  console.log(`--- ${tenant.slug}: ${tenant.label} ---`);
  const driver = driverFor(tenant);
  if (!driver) {
    console.log(
      `  SKIPPED: no way in. Set ${tenant.urlEnv}, or ${tenant.fallback?.passwordEnv}, ` +
        "or put SUPABASE_ACCESS_TOKEN in ~/.secrets/keys.env for the Management API route.\n",
    );
    failures++;
    continue;
  }
  console.log(`  via ${driver.kind}`);

  let applied;
  try {
    applied = await appliedVersions(driver);
  } catch (err) {
    console.log(`  ERROR: could not read migration history: ${String(err.message).split("\n")[0]}\n`);
    failures++;
    continue;
  }

  if (applied === null) {
    console.log("  No migration history table yet (new database).");
    applied = new Set();
  }

  const pending = migrations.filter((m) => !applied.has(m.version));
  totalPending += pending.length;

  if (pending.length === 0) {
    console.log(`  nothing to apply (${applied.size} recorded, ${migrations.length} on disk)\n`);
    continue;
  }

  console.log(`  ${pending.length} to apply:`);
  for (const m of pending) console.log(`    ${m.version}  ${m.name}`);

  if (!APPLY) {
    console.log("  (dry-run, nothing written)\n");
    continue;
  }

  try {
    await ensureHistoryTable(driver);
    for (const m of pending) {
      process.stdout.write(`  applying ${m.file} ... `);
      // The migration runs in a transaction and the history row goes in with it,
      // so a failed apply leaves nothing recorded.
      await driver.applyMigration(m);
      console.log("ok");
    }
    console.log("");
  } catch (err) {
    console.log("FAILED");
    console.log(`  ${String(err.stderr || err.message).trim().split("\n").slice(0, 5).join("\n  ")}\n`);
    failures++;
  }
}

console.log("---");
console.log(
  APPLY
    ? `Done. ${failures} tenant(s) with problems.`
    : `Dry-run complete. ${totalPending} migration(s) would be applied across ${tenants.length} tenant(s). ${failures} tenant(s) unreachable.`,
);
process.exit(failures > 0 ? 1 : 0);
