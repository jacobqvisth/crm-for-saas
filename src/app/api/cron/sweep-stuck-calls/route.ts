import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processCallSession } from "@/lib/calls/process";

// Safety net for the post-call AI pipeline. The pipeline is kicked from the
// 46elks hangup webhook via a Vercel `after()` background task; if that task is
// evicted or the function times out (maxDuration=300s — long recordings can hit
// it) the row is left stuck at status='processing' (or 'completed' if the kick
// never fired), never reaching 'processed'/'failed'. The hangup webhook's
// idempotency guard then refuses to re-kick a 'processing' row, so nothing
// recovers it automatically.
//
// This cron finds those stuck rows and re-runs processCallSession, which is
// idempotent (re-analyzes in place, reuses the existing activity_id). Runs every
// few minutes; a row is only "stuck" once it's been untouched past the timeout.
export const maxDuration = 300;

// Must be older than the function timeout (300s) plus margin, so we never grab a
// call that's legitimately mid-processing.
const STALE_AFTER_MS = 6 * 60 * 1000;
// Comfortably past the agent's own max call duration (10 minutes), so a live call
// is never mistaken for a stuck one.
const ORPHAN_AFTER_MS = 20 * 60 * 1000;
const BATCH = 5;
const CONCURRENCY = 2;

type StuckRow = { id: string; status: string };

async function handle(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  // 'processing' rows use updated_at (bumped when the pipeline last touched them);
  // 'completed' rows use ended_at (the kick either never fired or died before
  // setting 'processing'). Grab the oldest few of each.
  const [{ data: processingRows }, { data: completedRows }] = await Promise.all([
    supabase
      .from("call_sessions")
      .select("id, status")
      .eq("status", "processing")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(BATCH),
    supabase
      .from("call_sessions")
      .select("id, status")
      .eq("status", "completed")
      .lt("ended_at", cutoff)
      .order("ended_at", { ascending: true })
      .limit(BATCH),
  ]);

  const rows: StuckRow[] = [
    ...((processingRows ?? []) as StuckRow[]),
    ...((completedRows ?? []) as StuckRow[]),
  ].slice(0, BATCH);

  if (!rows.length) return NextResponse.json({ swept: 0, processed: 0, failed: 0 });

  let processed = 0;
  let failed = 0;

  const runOne = async (row: StuckRow) => {
    try {
      const result = await processCallSession(supabase, row.id);
      if (result.ok) processed++;
      else failed++;
    } catch (err) {
      failed++;
      console.error("sweep-stuck-calls: processCallSession failed", row.id, err);
    }
  };

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const i = cursor++;
        await runOne(rows[i]);
      }
    }),
  );

  const orphaned = await failOrphanedAgentJobs(supabase);

  return NextResponse.json({ swept: rows.length, processed, failed, orphaned });
}

/**
 * Close out agent jobs whose call is long over but which never left 'calling'.
 *
 * Nothing used to rescue these: the collector only looked at live sessions and
 * this sweeper only looked at call_sessions, so a job could sit at 'calling'
 * indefinitely. Two were stranded from 2026-08-13. The collect filter now also
 * covers 'no_recording', which fixes the common cause; this is the backstop for
 * anything that still slips through, so a stuck job cannot block the queue
 * (the worker dials only when no call is live).
 */
async function failOrphanedAgentJobs(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_AFTER_MS).toISOString();
  const { data, error } = await supabase
    .from("call_agent_jobs")
    .update({
      status: "failed",
      error: "Call never settled; swept after timeout",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "calling")
    .lt("started_at", cutoff)
    .select("id");
  if (error) {
    console.error("sweep-stuck-calls: orphan sweep failed", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

// Vercel Cron invokes the path with GET; allow POST too for manual triggering.
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
