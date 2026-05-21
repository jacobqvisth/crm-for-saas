// One-off ops script: revive the cancelled-but-active enrollments in the
// Czech / Lithuania / Estonia / Latvia sequences.
//
// Background (root cause is documented in the PR for /api/sequences/[id]/resume-all):
// `pause-all` cancels every scheduled queue row AND pauses the enrollment.
// The matching resume path only flipped `sequences.status` back to 'active'
// without reviving the cancelled queue rows. Someone (or a previous one-off
// script) then SQL-bulk-set enrollments back to status='active', leaving
// zombie state: enrollment looks active but no queue row is scheduled,
// so the cron has nothing to send.
//
// This script unsticks the four affected sequences by reviving each enrollment's
// MOST RECENT cancelled queue row → status='scheduled' with a fresh scheduled_for
// at the sequence's next send window. One row per enrollment; nothing else
// touched. Reply/bounce/unsubscribe terminal states are skipped (status!='active').
//
// Usage:
//   node scripts/unstick-dead-sequences.mjs               # dry-run (default)
//   node scripts/unstick-dead-sequences.mjs --apply       # actually do it
//
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");

// Czech / Lithuanian / Estonian / Latvian sequences (the four dead ones)
const DEAD_SEQ_NAMES = [
  "Czech Republic — Czech",
  "Lithuania — Lithuanian",
  "Estonia — Estonian",
  "Latvia — Latvian",
];

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log(APPLY ? "MODE: APPLY (writes will execute)" : "MODE: DRY-RUN (no writes)");
console.log("Target sequences:", DEAD_SEQ_NAMES.join(", "));

// --- Helpers (mirrors src/lib/sequences/scheduler.ts) ----------------------

const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function getZonedParts(d, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const hourRaw = parseInt(get("hour"));
  return {
    year: parseInt(get("year")),
    month: parseInt(get("month")),
    day: parseInt(get("day")),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: parseInt(get("minute")),
    weekday: DAY_MAP[get("weekday").toLowerCase().slice(0, 3)] ?? 0,
  };
}

function zonedToUtc(year, month, day, hour, minute, timezone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const observed = getZonedParts(guess, timezone);
  const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, 0);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = observedUtc - desiredUtc;
  return new Date(guess.getTime() - offset);
}

function isWithinSendWindow(settings, at = new Date()) {
  const tz = settings.timezone || "Europe/Stockholm";
  const startHour = settings.send_start_hour ?? 9;
  const endHour = settings.send_end_hour ?? 17;
  const allowedDays = new Set(settings.send_days);
  const parts = getZonedParts(at, tz);
  return allowedDays.has(parts.weekday) && parts.hour >= startHour && parts.hour < endHour;
}

function getNextSendTime(settings, afterDate) {
  const now = afterDate || new Date();
  const tz = settings.timezone || "Europe/Stockholm";
  const startHour = settings.send_start_hour ?? 9;
  const allowedDays = new Set(settings.send_days);
  if (isWithinSendWindow(settings, now)) return new Date(now.getTime() + 5000);
  const parts = getZonedParts(now, tz);
  for (let i = 0; i < 14; i++) {
    const candidate = zonedToUtc(parts.year, parts.month, parts.day + i, startHour, 0, tz);
    if (candidate.getTime() <= now.getTime()) continue;
    const cp = getZonedParts(candidate, tz);
    if (allowedDays.has(cp.weekday)) return candidate;
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

// --- Main ------------------------------------------------------------------

const { data: seqs, error: seqErr } = await supabase
  .from("sequences")
  .select("id, name, status, settings")
  .in("name", DEAD_SEQ_NAMES);

if (seqErr) {
  console.error("seq error:", seqErr);
  process.exit(1);
}

console.log(`\nFound ${seqs.length} target sequences:`);
for (const s of seqs) console.log(`  ${s.id}  ${s.status.padEnd(8)}  ${s.name}`);

let totalRevived = 0;
let totalSkipped = 0;

for (const seq of seqs) {
  console.log(`\n--- ${seq.name} ---`);
  if (seq.status !== "active") {
    console.log(`  sequence.status=${seq.status} — skipping (only touch active sequences)`);
    continue;
  }

  const nextWindow = getNextSendTime(seq.settings);
  console.log(`  next send window: ${nextWindow.toISOString()}`);

  const enrollmentIds = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id")
      .eq("sequence_id", seq.id)
      .eq("status", "active")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("  enrollment pagination error:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    enrollmentIds.push(...data.map((e) => e.id));
    if (data.length < PAGE) break;
  }
  console.log(`  active enrollments: ${enrollmentIds.length}`);

  const liveEnrollIds = new Set();
  const CHUNK = 200;
  for (let i = 0; i < enrollmentIds.length; i += CHUNK) {
    const chunk = enrollmentIds.slice(i, i + CHUNK);
    const { data: rows } = await supabase
      .from("email_queue")
      .select("enrollment_id")
      .in("enrollment_id", chunk)
      .eq("status", "scheduled");
    for (const r of rows || []) liveEnrollIds.add(r.enrollment_id);
  }
  const stuckIds = enrollmentIds.filter((id) => !liveEnrollIds.has(id));
  console.log(`  already-healthy (has scheduled row): ${liveEnrollIds.size}`);
  console.log(`  stuck (no scheduled row, candidate for revival): ${stuckIds.length}`);
  totalSkipped += liveEnrollIds.size;

  if (stuckIds.length === 0) continue;

  const reviveIds = [];
  const missingFallback = [];
  for (let i = 0; i < stuckIds.length; i += CHUNK) {
    const chunk = stuckIds.slice(i, i + CHUNK);
    const { data: rows } = await supabase
      .from("email_queue")
      .select("id, enrollment_id, created_at")
      .in("enrollment_id", chunk)
      .eq("status", "cancelled");
    const byEnroll = new Map();
    for (const r of rows || []) {
      const prev = byEnroll.get(r.enrollment_id);
      if (!prev || new Date(r.created_at) > new Date(prev.created_at)) {
        byEnroll.set(r.enrollment_id, { id: r.id, created_at: r.created_at });
      }
    }
    for (const id of chunk) {
      const hit = byEnroll.get(id);
      if (hit) reviveIds.push(hit.id);
      else missingFallback.push(id);
    }
  }
  console.log(`  will revive (latest cancelled row per enrollment): ${reviveIds.length}`);
  if (missingFallback.length > 0) {
    console.log(`  WARN: ${missingFallback.length} stuck enrollments have NO cancelled row — skipping (would need fresh enrollContacts)`);
  }

  if (!APPLY) {
    totalRevived += reviveIds.length;
    continue;
  }

  let revived = 0;
  for (let i = 0; i < reviveIds.length; i += CHUNK) {
    const chunk = reviveIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("email_queue")
      .update({
        status: "scheduled",
        scheduled_for: nextWindow.toISOString(),
      })
      .in("id", chunk);
    if (error) {
      console.error("  revival error:", error);
      process.exit(1);
    }
    revived += chunk.length;
  }
  console.log(`  REVIVED ${revived} queue rows`);
  totalRevived += revived;
}

console.log(`\n=== SUMMARY ===`);
console.log(`already-healthy enrollments (skipped): ${totalSkipped}`);
console.log(`${APPLY ? "revived" : "would revive"} queue rows: ${totalRevived}`);
console.log(APPLY ? "\nDone. The cron at /api/cron/process-emails should pick these up on its next tick." : "\nDRY-RUN complete. Re-run with --apply to execute.");
