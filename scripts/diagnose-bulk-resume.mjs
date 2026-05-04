// One-off ops script: diagnose Latvia + Estonia bulk-resume damage
// Reads-only — no writes.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") || l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: seqs, error: seqErr } = await supabase
  .from("sequences")
  .select("id, name, status")
  .or("name.ilike.%latvia%,name.ilike.%estonia%");

if (seqErr) { console.error("seq error:", seqErr); process.exit(1); }
console.log("\n=== Sequences ===");
for (const s of seqs) console.log(`${s.id}  ${s.status.padEnd(10)}  ${s.name}`);

for (const seq of seqs) {
  console.log(`\n--- ${seq.name} (${seq.id}) ---`);

  // Status breakdown
  const breakdown = {};
  for (const status of ["active", "paused", "company_paused", "completed", "replied", "bounced", "unsubscribed"]) {
    const { count } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", seq.id)
      .eq("status", status);
    breakdown[status] = count ?? 0;
  }
  console.log("status counts:", breakdown);

  // Wrongly-resumed: status='paused' AND completed_at IS NOT NULL
  // (After Jacob clicked "Pause Sending", everyone is now paused. The wrongly-resumed
  //  ones are the ones that have a completed_at timestamp — they were terminal before.)
  const { count: wronglyResumed } = await supabase
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", seq.id)
    .eq("status", "active")
    .not("completed_at", "is", null);
  console.log("wrongly-resumed (paused with completed_at):", wronglyResumed ?? 0);

  // Legit paused: status='paused' AND completed_at IS NULL
  const { count: legitPaused } = await supabase
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", seq.id)
    .eq("status", "active")
    .is("completed_at", null);
  console.log("legit paused (paused with no completed_at):", legitPaused ?? 0);

  // Scheduled queue items linked to wrongly-resumed enrollments (would have sent had we not paused)
  const { data: wrongIds } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", seq.id)
    .eq("status", "active")
    .not("completed_at", "is", null);

  if (wrongIds && wrongIds.length > 0) {
    // Chunk by 100 to avoid URL length issues
    let scheduled = 0, cancelled = 0, sent = 0;
    for (let i = 0; i < wrongIds.length; i += 200) {
      const chunk = wrongIds.slice(i, i + 200).map(r => r.id);
      const { count: s } = await supabase.from("email_queue").select("id", { count: "exact", head: true }).in("enrollment_id", chunk).eq("status", "scheduled");
      const { count: c } = await supabase.from("email_queue").select("id", { count: "exact", head: true }).in("enrollment_id", chunk).eq("status", "cancelled");
      const { count: snt } = await supabase.from("email_queue").select("id", { count: "exact", head: true }).in("enrollment_id", chunk).eq("status", "sent");
      scheduled += s ?? 0; cancelled += c ?? 0; sent += snt ?? 0;
    }
    console.log("queue for wrongly-resumed: scheduled=", scheduled, " cancelled=", cancelled, " sent(historical)=", sent);
  }
}

console.log("\nDone (read-only).");
