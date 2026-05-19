// One-off diagnostic: figure out why the "Min seconds between sends" save is failing.
// Reads .env.local to get the service-role key, then attempts the same query the
// UI's PATCH endpoint runs. Prints the exact error if any.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\n=== STEP 1: Read all gmail_accounts rows including new column ===");
const { data: rows, error: readErr } = await supabase
  .from("gmail_accounts")
  .select("id, email_address, max_daily_sends, min_send_interval_seconds")
  .order("created_at", { ascending: true });

if (readErr) {
  console.error("READ FAILED:", readErr.message);
  console.error("Full error:", JSON.stringify(readErr, null, 2));
  process.exit(1);
} else {
  console.log("READ OK. Column is present in API surface.");
  console.log("\nCurrent values:");
  for (const r of rows) {
    console.log(`  ${r.email_address.padEnd(35)} max=${r.max_daily_sends} min_interval=${r.min_send_interval_seconds ?? "<null>"}`);
  }
}

console.log("\n=== STEP 2: Attempt the same UPDATE the UI does ===");
const target = rows[0]; // first row
console.log(`Trying to set ${target.email_address} min_send_interval_seconds = ${target.min_send_interval_seconds ?? 60} (no-op write to same value)`);
const { error: updErr } = await supabase
  .from("gmail_accounts")
  .update({ min_send_interval_seconds: target.min_send_interval_seconds ?? 60 })
  .eq("id", target.id);

if (updErr) {
  console.error("UPDATE FAILED:", updErr.message);
  console.error("Full error:", JSON.stringify(updErr, null, 2));
  process.exit(1);
} else {
  console.log("UPDATE OK. Column is writable via PostgREST.");
}

console.log("\nIf both steps passed, the API and column are healthy.");
console.log("The 'Failed to update interval' must be coming from somewhere else (auth? RLS? frontend bug?).");
