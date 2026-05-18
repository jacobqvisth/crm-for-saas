// Bulk MillionVerifier runner for contacts (source='scb_registry').
//
// Mirrors scripts/verify-emails.mjs but targets `contacts` instead of `discovered_shops`.
// Reuses scripts/lib/email-verify.mjs — same loud-fail / status-mapping contract.
//
// Flags:
//   --apply             actually call MV + update DB (default is dry-run)
//   --limit N           process at most N rows (chunk past long runs)
//   --concurrency N     default 60; 80 is safe against MillionVerifier
//   --only-null         only contacts where email_status IS NULL OR ='unknown' (default behaviour)
//   --reverify          re-verify even contacts with concrete email_status (use with caution)
//
// Status updates contacts.email_status + email_verified_at.

import dotenv from "dotenv";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { verifyEmail, shouldSkip } from "./lib/email-verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const REVERIFY = process.argv.includes("--reverify");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;
const CONC_ARG = process.argv.indexOf("--concurrency");
const CONCURRENCY = CONC_ARG > -1 ? parseInt(process.argv[CONC_ARG + 1], 10) : 60;

const mvKey = process.env.MILLIONVERIFIER_API_KEY;
if (!mvKey) throw new Error("MILLIONVERIFIER_API_KEY missing from .env.local");

const sql = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  max: 1,
});

// Target: source='scb_registry' AND (unverified OR cache stale per shouldSkip)
const allCandidates = await sql`
  SELECT id, email, email_status, email_verified_at
  FROM contacts
  WHERE source = 'scb_registry'
    AND email IS NOT NULL
    AND email != ''
`;

const targets = allCandidates.filter((c) => {
  if (REVERIFY) return true;
  if (!c.email_status || c.email_status === "unknown") return true;
  return !shouldSkip(c.email_status, c.email_verified_at);
});

const limited = LIMIT ? targets.slice(0, LIMIT) : targets;
console.log(`SCB-source contacts: ${allCandidates.length}`);
console.log(`To verify (after skip-cache): ${targets.length}`);
if (LIMIT) console.log(`Limited to: ${limited.length}`);
console.log(`Concurrency: ${CONCURRENCY}`);

if (!APPLY) {
  console.log(`\nDRY-RUN. Re-run with --apply to call MV + write status.`);
  await sql.end();
  process.exit(0);
}

const counts = { valid: 0, invalid: 0, catch_all: 0, risky: 0, errors: 0 };
let done = 0;
const startedAt = Date.now();

// Worker pool: process queue with N concurrent workers.
const queue = [...limited];

async function worker(id) {
  while (queue.length > 0) {
    const c = queue.shift();
    if (!c) break;
    try {
      const { status } = await verifyEmail(c.email, mvKey);
      counts[status] = (counts[status] || 0) + 1;
      await sql`
        UPDATE contacts
        SET email_status = ${status}, email_verified_at = now(), updated_at = now()
        WHERE id = ${c.id}
      `;
    } catch (err) {
      counts.errors++;
      console.error(`\n[w${id}] ${c.email}: ${err.message}`);
    }
    done++;
    if (done % 25 === 0 || done === limited.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / elapsed;
      const eta = ((limited.length - done) / rate / 60).toFixed(1);
      process.stdout.write(
        `\r  ${done}/${limited.length} (${(rate).toFixed(1)}/s, ETA ${eta}m) — valid=${counts.valid} invalid=${counts.invalid} catch_all=${counts.catch_all} risky=${counts.risky} err=${counts.errors}`
      );
    }
  }
}

const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
await Promise.all(workers);

console.log(`\n\nFinal: valid=${counts.valid} invalid=${counts.invalid} catch_all=${counts.catch_all} risky=${counts.risky} errors=${counts.errors}`);

// Distribution snapshot
const snap = await sql`
  SELECT email_status, COUNT(*)::int AS n
  FROM contacts
  WHERE source = 'scb_registry'
  GROUP BY email_status
  ORDER BY n DESC
`;
console.log(`\nSCB-source contact email_status distribution:`);
for (const r of snap) console.log(`  ${r.email_status || '(null)'}: ${r.n}`);

await sql.end();
