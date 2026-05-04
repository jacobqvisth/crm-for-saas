// Diagnose why GB contacts can't be enrolled into the UK sequence.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SEQUENCE_ID = "ab43800a-e996-40cc-8ffa-437ee1c0386b"; // United Kingdom — English

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: seq } = await supabase.from("sequences").select("id, name, status, workspace_id").eq("id", SEQUENCE_ID).single();
console.log("Sequence:", seq);

// 1. GB contacts overall in this workspace
const { count: gbTotal } = await supabase
  .from("contacts")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", seq.workspace_id)
  .eq("country_code", "GB");
console.log(`\nTotal GB contacts in workspace: ${gbTotal}`);

// 2. Status breakdown for GB contacts
const { data: gbAll } = await supabase
  .from("contacts")
  .select("status, email_status, email")
  .eq("workspace_id", seq.workspace_id)
  .eq("country_code", "GB");

const statusBreakdown = {};
const emailStatusBreakdown = {};
for (const c of gbAll) {
  statusBreakdown[c.status ?? "(null)"] = (statusBreakdown[c.status ?? "(null)"] || 0) + 1;
  emailStatusBreakdown[c.email_status ?? "(null)"] = (emailStatusBreakdown[c.email_status ?? "(null)"] || 0) + 1;
}
console.log("GB contacts.status breakdown:", statusBreakdown);
console.log("GB contacts.email_status breakdown:", emailStatusBreakdown);

// 3. Existing enrollments in this sequence
const { count: existingEnrolled } = await supabase
  .from("sequence_enrollments")
  .select("id", { count: "exact", head: true })
  .eq("sequence_id", SEQUENCE_ID);
console.log(`\nExisting enrollments in this sequence: ${existingEnrolled}`);

// 4. Cross-sequence enrollments for GB contacts (would they be deduped against another sequence?)
const gbContactIds = gbAll.map(c => c.id);
console.log(`\nFirst 3 GB contact emails as sample:`);
for (const c of gbAll.slice(0, 3)) console.log(`  ${c.email} status=${c.status} email_status=${c.email_status}`);

// 5. Unsubscribes for this workspace
const { count: unsubCount } = await supabase
  .from("unsubscribes")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", seq.workspace_id);
console.log(`\nUnsubscribes in workspace: ${unsubCount}`);

// 6. Sequence steps
const { data: steps } = await supabase.from("sequence_steps").select("step_order, type").eq("sequence_id", SEQUENCE_ID).order("step_order");
console.log(`\nSequence steps:`, steps);

// 7. Sequence settings — does it have a rotation pool?
const { data: seqFull } = await supabase.from("sequences").select("settings").eq("id", SEQUENCE_ID).single();
console.log(`\nSequence settings:`, seqFull?.settings);

// 8. Gmail accounts — capacity?
const { data: accounts } = await supabase
  .from("gmail_accounts")
  .select("id, email_address, status, daily_sends_count, max_daily_sends, pause_reason")
  .eq("workspace_id", seq.workspace_id);
console.log(`\nGmail accounts in workspace:`);
const accountIds = new Set(accounts.map(a => a.id));
for (const a of accounts) {
  const remaining = (a.max_daily_sends ?? 0) - (a.daily_sends_count ?? 0);
  console.log(`  ${a.id}  ${a.email_address}  status=${a.status}  ${a.daily_sends_count}/${a.max_daily_sends} (${remaining} remaining)`);
}

// 9. Pool intersection — do the pool IDs match any real account IDs?
const pool = seqFull.settings.rotation_account_ids || [];
console.log(`\nRotation pool IDs (${pool.length}):`);
for (const id of pool) {
  console.log(`  ${id}  ${accountIds.has(id) ? "✅ in workspace" : "❌ NOT in workspace"}`);
}

// 10. ALL GB contacts status breakdown — paginate past 1000 to see the full picture
console.log(`\nAll GB contacts status breakdown (paginated):`);
const fullStatusBreakdown = {};
for (let offset = 0; offset < gbTotal; offset += 1000) {
  const { data: page } = await supabase
    .from("contacts")
    .select("status")
    .eq("workspace_id", seq.workspace_id)
    .eq("country_code", "GB")
    .range(offset, offset + 999);
  for (const c of (page || [])) {
    fullStatusBreakdown[c.status ?? "(null)"] = (fullStatusBreakdown[c.status ?? "(null)"] || 0) + 1;
  }
}
console.log(`  ${JSON.stringify(fullStatusBreakdown)}`);

// Reproduce the .in() query that enrollContacts does — with 1000 GB contact IDs
console.log(`\n=== Reproducing the failing query ===`);
const { data: idPage } = await supabase
  .from("contacts")
  .select("id")
  .eq("workspace_id", seq.workspace_id)
  .eq("country_code", "GB")
  .limit(1000);
const ids = (idPage || []).map(r => r.id);
console.log(`Got ${ids.length} GB contact IDs.`);

const { data: bigIn, error: bigErr } = await supabase
  .from("contacts")
  .select("*, companies(*)")
  .in("id", ids)
  .eq("workspace_id", seq.workspace_id);
console.log(`.in() with ${ids.length} ids: data?.length=${bigIn?.length}  error=${bigErr ? JSON.stringify(bigErr) : "none"}`);

// And try without the companies join
const { data: noJoin, error: noJoinErr } = await supabase
  .from("contacts")
  .select("*")
  .in("id", ids)
  .eq("workspace_id", seq.workspace_id);
console.log(`.in() without join: data?.length=${noJoin?.length}  error=${noJoinErr ? JSON.stringify(noJoinErr) : "none"}`);

// 11. Contact lists in workspace — find the GB list
const { data: allLists } = await supabase
  .from("contact_lists")
  .select("id, name, is_dynamic, filters, created_at")
  .eq("workspace_id", seq.workspace_id)
  .order("created_at", { ascending: false })
  .limit(15);
console.log(`\nLatest 15 contact lists:`);
for (const l of (allLists || [])) {
  console.log(`  ${l.id}  ${l.name}  is_dynamic=${l.is_dynamic}  filters=${JSON.stringify(l.filters)}`);
}
