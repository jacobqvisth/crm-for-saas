import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const seqId = "5ab6063b-c365-4c8f-ace8-392a3d90346a";

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: seq, error: seqErr } = await sb
  .from("sequences")
  .select("id, name, status, workspace_id, settings")
  .eq("id", seqId)
  .single();
console.log("=== sequence ===");
console.log(seqErr || JSON.stringify({ ...seq, settings: undefined }, null, 2));
console.log("settings:", JSON.stringify(seq?.settings, null, 2));

const { count: enrollCount } = await sb
  .from("sequence_enrollments")
  .select("id", { count: "exact", head: true })
  .eq("sequence_id", seqId);
console.log("\n=== enrollments total ===", enrollCount);

const { data: enrollStatusRaw } = await sb
  .from("sequence_enrollments")
  .select("status")
  .eq("sequence_id", seqId);
const enrollStatusCount = {};
for (const r of enrollStatusRaw || []) enrollStatusCount[r.status] = (enrollStatusCount[r.status] || 0) + 1;
console.log("enrollments by status (sample, capped at 1000):", enrollStatusCount, "rows seen:", enrollStatusRaw?.length);

// Get all enrollment IDs in chunks to avoid the 1000-row default
const allEnrollIds = [];
let offset = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await sb
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", seqId)
    .range(offset, offset + PAGE - 1);
  if (error) { console.log("paginate err", error); break; }
  if (!data || data.length === 0) break;
  allEnrollIds.push(...data.map((r) => r.id));
  if (data.length < PAGE) break;
  offset += PAGE;
}
console.log("\n=== all enrollment ids fetched (paginated) ===", allEnrollIds.length);

// Count email_queue rows by status, chunked .in()
const CHUNK = 200;
const queueStatusCount = {};
let queueTotal = 0;
for (let i = 0; i < allEnrollIds.length; i += CHUNK) {
  const chunk = allEnrollIds.slice(i, i + CHUNK);
  const { data, error } = await sb
    .from("email_queue")
    .select("status")
    .in("enrollment_id", chunk);
  if (error) { console.log("queue chunk err", error); continue; }
  for (const r of data || []) {
    queueStatusCount[r.status] = (queueStatusCount[r.status] || 0) + 1;
    queueTotal++;
  }
}
console.log("=== email_queue rows for these enrollments ===", queueTotal);
console.log("by status:", queueStatusCount);

// Sample one queue row to see scheduled_for
const { data: sampleQueue } = await sb
  .from("email_queue")
  .select("id, status, scheduled_for, sender_account_id, step_id, created_at")
  .in("enrollment_id", allEnrollIds.slice(0, 200))
  .limit(3);
console.log("\n=== sample queue rows ===");
console.log(JSON.stringify(sampleQueue, null, 2));

// Steps
const { data: steps } = await sb
  .from("sequence_steps")
  .select("id, step_order, type, delay_days, delay_hours, template_id, subject_override")
  .eq("sequence_id", seqId)
  .order("step_order");
console.log("\n=== sequence steps ===");
console.log(JSON.stringify(steps, null, 2));
