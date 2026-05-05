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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const seqId = "5ab6063b-c365-4c8f-ace8-392a3d90346a";

// 1. Paginate enrollment ids past the 1000-row default
const allEnrollIds = [];
let offset = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await sb
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", seqId)
    .range(offset, offset + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  allEnrollIds.push(...data.map((r) => r.id));
  if (data.length < PAGE) break;
  offset += PAGE;
}
console.log("enrollment ids fetched:", allEnrollIds.length);

// 2. Chunk the .in() update at 200 ids
const CHUNK = 200;
const scheduledFor = new Date().toISOString();
let totalUpdated = 0;
for (let i = 0; i < allEnrollIds.length; i += CHUNK) {
  const chunk = allEnrollIds.slice(i, i + CHUNK);
  const { data, error } = await sb
    .from("email_queue")
    .update({ status: "scheduled", scheduled_for: scheduledFor })
    .in("enrollment_id", chunk)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("chunk", i, "error:", error);
    process.exit(1);
  }
  totalUpdated += data?.length ?? 0;
  process.stdout.write(`.`);
}
console.log("\nrows promoted pending → scheduled:", totalUpdated);

// 3. Verify
const verifyCount = {};
for (let i = 0; i < allEnrollIds.length; i += CHUNK) {
  const chunk = allEnrollIds.slice(i, i + CHUNK);
  const { data } = await sb.from("email_queue").select("status").in("enrollment_id", chunk);
  for (const r of data || []) verifyCount[r.status] = (verifyCount[r.status] || 0) + 1;
}
console.log("post-fix status counts:", verifyCount);
