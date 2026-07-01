import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  findPhonesForRecord,
  saveFoundPhones,
  classifyPhoneSearchOutcome,
} from "@/lib/enrich/find-phone-for-contact";

// Each contact does website discovery + scrape + AI web search — slow. Claim a
// small batch per run and let the schedule drain the queue over time.
export const maxDuration = 300;
const BATCH = 9;
const CONCURRENCY = 3;

type Job = {
  id: string;
  workspace_id: string;
  contact_id: string;
  attempts: number | null;
};

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Claim the oldest queued jobs and mark them processing so overlapping runs
  // don't pick the same rows.
  const { data: claimed } = await supabase
    .from("phone_enrichment_jobs")
    .select("id, workspace_id, contact_id, attempts")
    .eq("status", "queued")
    .order("enqueued_at", { ascending: true })
    .limit(BATCH);

  const jobs = (claimed ?? []) as Job[];
  if (!jobs.length) return NextResponse.json({ claimed: 0, done: 0, errored: 0 });

  await supabase
    .from("phone_enrichment_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .in(
      "id",
      jobs.map((j) => j.id),
    );

  let done = 0;
  let errored = 0;

  const runOne = async (job: Job) => {
    const attempts = (job.attempts ?? 0) + 1;
    try {
      const result = await findPhonesForRecord(supabase, {
        workspaceId: job.workspace_id,
        contactId: job.contact_id,
      });
      const saved = result.phones.length
        ? await saveFoundPhones(supabase, {
            workspaceId: job.workspace_id,
            contactId: job.contact_id,
            companyId: result.companyId,
            countryCode: result.countryCode,
            phones: result.phones,
          })
        : 0;
      await supabase
        .from("phone_enrichment_jobs")
        .update({
          status: "done",
          outcome: classifyPhoneSearchOutcome(result),
          saved_count: saved,
          website_added: result.websiteAdded,
          finished_at: new Date().toISOString(),
          attempts,
        })
        .eq("id", job.id);
      done++;
    } catch (err) {
      errored++;
      await supabase
        .from("phone_enrichment_jobs")
        .update({
          status: "error",
          error: err instanceof Error ? err.message : "failed",
          finished_at: new Date().toISOString(),
          attempts,
        })
        .eq("id", job.id);
    }
  };

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const i = cursor++;
        await runOne(jobs[i]);
      }
    }),
  );

  return NextResponse.json({ claimed: jobs.length, done, errored });
}
