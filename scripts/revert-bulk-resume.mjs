// One-off ops script: revert the bulk-Resume damage on Latvia + Estonia sequences.
//
// Phase 1 (DRY-RUN, default): print exactly what we'd change. No writes.
// Phase 2 (--apply): execute the writes.
//
// What it does:
//   For each enrollment in (Latvia, Estonia) with status='active':
//   - If completed_at IS NOT NULL                                    →  TERMINAL:
//        derive correct status from email_events + unsubscribes
//        (priority: unsubscribed > replied > bounced > completed),
//        UPDATE status to that.
//   - Else if has NO queue items in (scheduled|pending|sending)      →  WAS PAUSED:
//        UPDATE status='paused' (revert to pre-bulk-Resume state).
//   - Else                                                           →  ALWAYS-ACTIVE:
//        leave alone. Had a queued next step before the bulk Resume,
//        which means the bulk Resume was a no-op on it (already active).
//
//   We do NOT cancel any queue items — the always-active subset's pipeline must keep flowing.
//   The cron will naturally cancel queue items belonging to enrollments we revert to paused
//   (process-emails:187 checks enrollment.status === 'active' before sending).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const SEQUENCE_IDS = [
  "9f26cc20-e765-4bce-bf89-447d51cd2bee", // Latvia — Latvian
  "6f2ad382-d7c3-4197-a592-9dcc41ab5554", // Estonia — Estonian
];

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log(APPLY ? "MODE: APPLY (writes will execute)" : "MODE: DRY-RUN (no writes)");
console.log("Sequences:", SEQUENCE_IDS.join(", "));

// 1. Pull all active enrollments in scope, plus their contact_id (for unsubscribe lookup).
const { data: scope } = await supabase
  .from("sequence_enrollments")
  .select("id, sequence_id, contact_id, current_step, completed_at")
  .in("sequence_id", SEQUENCE_IDS)
  .eq("status", "active");

console.log(`\nIn-scope active enrollments: ${scope.length}`);

const terminalScope = scope.filter(e => e.completed_at !== null);
const nonTerminalScope = scope.filter(e => e.completed_at === null);
console.log(`  terminal (completed_at NOT NULL): ${terminalScope.length}`);
console.log(`  non-terminal (completed_at IS NULL): ${nonTerminalScope.length}`);

// 1a. Among non-terminal active enrollments, distinguish three cases by their queue history:
//     - "always-active": has a LIVE queue item (scheduled/pending/sending) → pipeline healthy, leave alone.
//     - "was-paused":     has NO live item but DOES have a CANCELLED item → was paused before, cancel-on-pause left a fingerprint → revert to paused.
//     - "ambiguous":      has neither live nor cancelled items → fresh enrollment or weird state, leave alone for safety.
const nonTerminalIds = nonTerminalScope.map(e => e.id);
const enrollsWithLiveQueue = new Set();
const enrollsWithCancelledQueue = new Set();
for (let i = 0; i < nonTerminalIds.length; i += 200) {
  const chunk = nonTerminalIds.slice(i, i + 200);
  const { data: rows } = await supabase
    .from("email_queue")
    .select("enrollment_id, status")
    .in("enrollment_id", chunk)
    .in("status", ["scheduled", "pending", "sending", "cancelled"]);
  for (const r of (rows || [])) {
    if (r.status === "cancelled") enrollsWithCancelledQueue.add(r.enrollment_id);
    else enrollsWithLiveQueue.add(r.enrollment_id);
  }
}
const alwaysActiveScope = nonTerminalScope.filter(e => enrollsWithLiveQueue.has(e.id));
const wasPausedScope = nonTerminalScope.filter(e => !enrollsWithLiveQueue.has(e.id) && enrollsWithCancelledQueue.has(e.id));
const ambiguousScope = nonTerminalScope.filter(e => !enrollsWithLiveQueue.has(e.id) && !enrollsWithCancelledQueue.has(e.id));
console.log(`    of non-terminal:`);
console.log(`      always-active (has live queue item, leave alone): ${alwaysActiveScope.length}`);
console.log(`      was-paused (no live item, has cancelled item, revert to paused): ${wasPausedScope.length}`);
console.log(`      ambiguous (no queue items at all, leave alone): ${ambiguousScope.length}`);

// 2. For each terminal enrollment, derive the correct status.
//    Lookups: unsubscribes (by contact email), email_events (by tracking_id from email_queue rows).

// 2a. Pull contact emails for terminal scope so we can match against unsubscribes.
const terminalContactIds = [...new Set(terminalScope.map(e => e.contact_id))];
const contactEmail = new Map();
for (let i = 0; i < terminalContactIds.length; i += 200) {
  const chunk = terminalContactIds.slice(i, i + 200);
  const { data: rows } = await supabase.from("contacts").select("id, email, workspace_id").in("id", chunk);
  for (const r of (rows || [])) contactEmail.set(r.id, { email: r.email?.toLowerCase(), workspace_id: r.workspace_id });
}

// 2b. Pull unsubscribes for those contact emails (per workspace).
const unsubKey = new Set(); // `${workspace_id}|${email}`
const allEmails = [...new Set([...contactEmail.values()].map(v => v.email).filter(Boolean))];
for (let i = 0; i < allEmails.length; i += 200) {
  const chunk = allEmails.slice(i, i + 200);
  const { data: rows } = await supabase.from("unsubscribes").select("workspace_id, email").in("email", chunk);
  for (const r of (rows || [])) unsubKey.add(`${r.workspace_id}|${r.email?.toLowerCase()}`);
}

// 2c. Pull tracking_ids from email_queue for terminal enrollments, then look up reply/bounce events.
const terminalEnrollIds = terminalScope.map(e => e.id);
const trackingByEnroll = new Map(); // enrollment_id -> Set(tracking_id)
for (let i = 0; i < terminalEnrollIds.length; i += 200) {
  const chunk = terminalEnrollIds.slice(i, i + 200);
  const { data: rows } = await supabase.from("email_queue").select("enrollment_id, tracking_id").in("enrollment_id", chunk);
  for (const r of (rows || [])) {
    if (!r.tracking_id) continue;
    const set = trackingByEnroll.get(r.enrollment_id) || new Set();
    set.add(r.tracking_id);
    trackingByEnroll.set(r.enrollment_id, set);
  }
}

const allTracking = [...new Set([...trackingByEnroll.values()].flatMap(s => [...s]))];
const repliedTracking = new Set();
const bouncedTracking = new Set();
for (let i = 0; i < allTracking.length; i += 200) {
  const chunk = allTracking.slice(i, i + 200);
  const { data: rows } = await supabase.from("email_events").select("tracking_id, event_type").in("tracking_id", chunk).in("event_type", ["reply", "bounce"]);
  for (const r of (rows || [])) {
    if (r.event_type === "reply") repliedTracking.add(r.tracking_id);
    else if (r.event_type === "bounce") bouncedTracking.add(r.tracking_id);
  }
}

// 2d. For each terminal enrollment, decide the status.
const decisions = []; // {id, newStatus, contact_email, reason}
for (const e of terminalScope) {
  const c = contactEmail.get(e.contact_id);
  const tracking = trackingByEnroll.get(e.id) || new Set();
  let newStatus, reason;
  if (c && c.email && unsubKey.has(`${c.workspace_id}|${c.email}`)) {
    newStatus = "unsubscribed"; reason = "contact unsubscribed";
  } else if ([...tracking].some(t => repliedTracking.has(t))) {
    newStatus = "replied"; reason = "reply event found";
  } else if ([...tracking].some(t => bouncedTracking.has(t))) {
    newStatus = "bounced"; reason = "bounce event found";
  } else {
    newStatus = "completed"; reason = "no reply/bounce/unsub signal — defaulting to completed";
  }
  decisions.push({ id: e.id, newStatus, reason });
}

const tally = decisions.reduce((acc, d) => { acc[d.newStatus] = (acc[d.newStatus] || 0) + 1; return acc; }, {});
console.log("\n=== Phase A: terminal-revert decisions ===");
console.log("By new status:", tally);

console.log("\n=== Phase B: revert was-paused enrollments ===");
console.log(`Will set status='paused' on ${wasPausedScope.length} enrollments (was-paused: had no live queue item, so they had been originally paused/co_paused before the bulk Resume click).`);

console.log(`\n=== Phase C (skipped): always-active enrollments untouched ===`);
console.log(`${alwaysActiveScope.length} enrollments left as status='active' — pipeline stays intact, normal sending continues.`);

if (!APPLY) {
  console.log("\nDRY-RUN complete. Re-run with --apply to execute.");
  process.exit(0);
}

console.log("\n--- APPLYING WRITES ---");

// 4. Apply Phase A: terminal revert.
const byStatus = decisions.reduce((acc, d) => { (acc[d.newStatus] ||= []).push(d.id); return acc; }, {});
for (const [status, ids] of Object.entries(byStatus)) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await supabase.from("sequence_enrollments").update({ status }).in("id", chunk);
    if (error) { console.error(`Phase A error setting ${status}:`, error); process.exit(1); }
  }
  console.log(`  set ${ids.length} enrollments to status=${status}`);
}

// 5. Apply Phase B: was-paused revert.
const wasPausedIds = wasPausedScope.map(e => e.id);
for (let i = 0; i < wasPausedIds.length; i += 200) {
  const chunk = wasPausedIds.slice(i, i + 200);
  const { error } = await supabase.from("sequence_enrollments").update({ status: "paused" }).in("id", chunk);
  if (error) { console.error("Phase B error:", error); process.exit(1); }
}
console.log(`  set ${wasPausedIds.length} enrollments to status=paused`);

console.log(`\nALWAYS-ACTIVE: ${alwaysActiveScope.length} left as status='active' (pipeline intact).`);

console.log("\nDONE. Run scripts/diagnose-bulk-resume.mjs to verify.");
