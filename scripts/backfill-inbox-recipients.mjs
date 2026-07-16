#!/usr/bin/env node
/**
 * One-off backfill of inbox_messages.to_emails / delivered_to.
 *
 * Historic inbound rows were logged before the mailbox-sync cron captured
 * recipients, so the alias "lane" filter (e.g. support@wrenchlane.com) can't
 * see them. This script re-fetches the To/Cc/Delivered-To headers for those
 * rows from Gmail and writes them back. Going forward, the cron populates these
 * columns at receipt time, so this only catches up existing rows.
 *
 * Scope: by default only the mailbox that owns the support@ alias
 * (hans@wrenchlane.com). Pass --account=<email> to target another, or
 * --account=all for every connected mailbox.
 *
 * Usage:
 *   node scripts/backfill-inbox-recipients.mjs [--account=hans@wrenchlane.com] [--limit=N] [--dry-run]
 *
 * Reads creds from ~/crm-for-saas/.env.local: SUPABASE_DB_PASSWORD,
 * ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Safe to re-run — only
 * touches rows whose to_emails is still empty AND delivered_to IS NULL.
 */
import dotenv from "/Users/jacobqvisth/crm-for-saas/node_modules/dotenv/lib/main.js";
import pkg from "/Users/jacobqvisth/crm-for-saas/node_modules/pg/lib/index.js";
import { createDecipheriv } from "crypto";

dotenv.config({ path: "/Users/jacobqvisth/crm-for-saas/.env.local" });

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? "true");
}
const ACCOUNT = args.get("account") || "hans@wrenchlane.com";
const LIMIT = args.has("limit") ? Number(args.get("limit")) : Infinity;
const DRY_RUN = args.get("dry-run") === "true";
const CONCURRENCY = 8;

// --- AES-256-GCM decrypt, mirroring src/lib/encryption.ts (iv:tag:ct base64) ---
function decrypt(encryptedString) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const [ivB64, tagB64, ctB64] = encryptedString.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// --- header parsing, mirroring src/lib/gmail/messages.ts ---
function parseEmail(raw) {
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return (m ? m[2] : raw).trim().toLowerCase();
}
function parseAddressList(raw) {
  if (!raw) return [];
  return raw
    .split(/,(?![^<]*>)/)
    .map(parseEmail)
    .filter((e) => e.includes("@"));
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function fetchHeaders(accessToken, msgId) {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}` +
    `?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Delivered-To`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null; // message deleted from mailbox
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return fetchHeaders(accessToken, msgId);
  }
  if (!res.ok) throw new Error(`messages.get ${msgId}: ${res.status}`);
  const data = await res.json();
  const headers = data.payload?.headers ?? [];
  const get = (name) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
  const toEmails = [
    ...parseAddressList(get("to")),
    ...parseAddressList(get("cc")),
  ];
  const deliveredTo = parseEmail(get("delivered-to")) || null;
  return { toEmails: [...new Set(toEmails)], deliveredTo };
}

async function main() {
  const pg = new pkg.Client({
    host: "aws-1-eu-north-1.pooler.supabase.com",
    port: 5432,
    user: "postgres.wdgiwuhehqpkhpvdzzzl",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();

  // Load target accounts + their (encrypted) refresh tokens.
  const acctFilter = ACCOUNT === "all" ? "" : "AND ga.email_address = $1";
  const acctRes = await pg.query(
    `SELECT ga.id, ga.email_address, ga.refresh_token
       FROM gmail_accounts ga
      WHERE ga.status <> 'disconnected' AND ga.refresh_token IS NOT NULL ${acctFilter}`,
    ACCOUNT === "all" ? [] : [ACCOUNT],
  );
  if (acctRes.rows.length === 0) {
    console.error(`No matching connected account for "${ACCOUNT}".`);
    await pg.end();
    process.exit(1);
  }

  let totalUpdated = 0;
  for (const acct of acctRes.rows) {
    const rows = (
      await pg.query(
        `SELECT id, gmail_message_id
           FROM inbox_messages
          WHERE gmail_account_id = $1
            AND to_emails = '{}' AND delivered_to IS NULL
          ORDER BY received_at DESC`,
        [acct.id],
      )
    ).rows.slice(0, LIMIT === Infinity ? undefined : LIMIT);

    console.log(`\n${acct.email_address}: ${rows.length} rows to backfill${DRY_RUN ? " (dry-run)" : ""}`);
    if (rows.length === 0) continue;

    const accessToken = await refreshAccessToken(decrypt(acct.refresh_token));

    let i = 0;
    let updated = 0;
    let done = 0;
    async function worker() {
      while (i < rows.length) {
        const row = rows[i++];
        try {
          const parsed = await fetchHeaders(accessToken, row.gmail_message_id);
          done++;
          if (!parsed) continue;
          if (parsed.toEmails.length === 0 && !parsed.deliveredTo) continue;
          if (!DRY_RUN) {
            await pg.query(
              `UPDATE inbox_messages SET to_emails = $1, delivered_to = $2 WHERE id = $3`,
              [parsed.toEmails, parsed.deliveredTo, row.id],
            );
          }
          updated++;
        } catch (err) {
          console.error(`  ${row.gmail_message_id}: ${err.message}`);
        }
        if (done % 200 === 0) console.log(`  …${done}/${rows.length} fetched, ${updated} updated`);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`  ${acct.email_address}: ${updated} updated (${done} fetched).`);
    totalUpdated += updated;
  }

  console.log(`\nDone. ${totalUpdated} rows updated${DRY_RUN ? " (dry-run — no writes)" : ""}.`);
  await pg.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
