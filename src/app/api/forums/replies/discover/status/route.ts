import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { pollApifySearchRuns } from "@/lib/forums/reddit-apify";
import { upsertCandidates } from "@/lib/forums/candidates";

// Polling is a couple of quick Apify status/dataset reads — fast.
export const maxDuration = 60;

const bodySchema = z.object({
  runs: z
    .array(
      z.object({
        sub: z.string().max(80),
        runId: z.string().max(64),
        datasetId: z.string().max(64),
      }),
    )
    .max(12),
  limit: z.number().int().min(1).max(100).optional(),
  // Echoed back from the client purely as provenance on the saved rows.
  query: z.string().max(300).optional(),
  sort: z.string().max(20).optional(),
});

// POST /api/forums/replies/discover/status
// Given the run handles returned by /discover (mode:"async"), report progress:
// { done, posts, perSub: [{ sub, status }], saved }. The client calls this on an
// interval and streams posts in as each subreddit's run finishes.
//
// Every tick also upserts what it has into forum_candidates, so results are
// durable the moment they arrive: navigate away mid-search, or reload tomorrow,
// and the questions are still there instead of dying with the component state.
// Writing on each tick rather than only at `done` is deliberate — it's one cheap
// idempotent statement, and it means an abandoned search still banks the
// subreddits that had already finished.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const progress = await pollApifySearchRuns(parsed.data.runs, parsed.data.limit ?? 25);

  const { saved, error } = await upsertCandidates({
    supabase: supabase as unknown as SupabaseClient,
    workspaceId,
    posts: progress.posts,
    via: "search",
    query: parsed.data.query ?? null,
    sort: parsed.data.sort ?? null,
  });
  // A failed cache write must not break the search the user is watching: they
  // still get the posts, they just aren't persisted. Report it so the client can
  // say so instead of implying the queue was saved.
  if (error) console.error("[forums] candidate upsert failed:", error);

  return NextResponse.json({ ...progress, saved, savedError: error });
}
