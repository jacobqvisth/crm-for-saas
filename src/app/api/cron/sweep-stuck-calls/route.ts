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

  return NextResponse.json({ swept: rows.length, processed, failed });
}

// Vercel Cron invokes the path with GET; allow POST too for manual triggering.
export async function GET(request: NextRequest) {
  return handle(request);
}
export async function POST(request: NextRequest) {
  return handle(request);
}
