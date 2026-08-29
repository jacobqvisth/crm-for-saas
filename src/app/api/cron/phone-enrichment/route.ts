import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  findPhonesForRecord,
  saveFoundPhones,
  classifyPhoneSearchOutcome,
} from "@/lib/enrich/find-phone-for-contact";
import { cronGate } from "@/lib/features";

// Each contact does website discovery + scrape + AI web search — slow. Claim a
// small batch per run and let the schedule drain the queue over time.
export const maxDuration = 300;
// Each job now does scrape → Google Maps (Apify, ~45s cap) → AI web search only
// if both miss (~90s cap). Worst case is ~135s/contact; at CONCURRENCY 3 that's
// ~2 sequential per worker, so keep the batch at 6 to stay under maxDuration.
const BATCH = 6;
const CONCURRENCY = 3;
// Shared wall-clock deadline for the run. Each search budgets its legs against
// it, so the second wave degrades (skips its slow legs) rather than letting the
// platform kill the worker — which would leave jobs stuck in "processing".
const RUN_BUDGET_MS = 270_000;

type Job = {
  id: string;
  workspace_id: string;
  contact_id: string;
  attempts: number | null;
};

async function handle(request: NextRequest) {
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
  const deadline = Date.now() + RUN_BUDGET_MS;

  const runOne = async (job: Job) => {
    const attempts = (job.attempts ?? 0) + 1;
    try {
      const result = await findPhonesForRecord(supabase, {
        workspaceId: job.workspace_id,
        contactId: job.contact_id,
        deadline,
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

// Vercel Cron invokes the path with GET; allow POST too for manual triggering.
export async function GET(request: NextRequest) {
  // Feature gate. 200 rather than an error: a switched-off feature is not
  // a failure, and a cron that fails on a schedule buries the alert channel.
  const skip = cronGate("discovery");
  if (skip) return skip;

  return handle(request);
}
export async function POST(request: NextRequest) {
  // Feature gate. 200 rather than an error: a switched-off feature is not
  // a failure, and a cron that fails on a schedule buries the alert channel.
  const skip = cronGate("discovery");
  if (skip) return skip;

  return handle(request);
}
