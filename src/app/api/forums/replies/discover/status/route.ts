import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { pollApifySearchRuns } from "@/lib/forums/reddit-apify";

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
});

// POST /api/forums/replies/discover/status
// Given the run handles returned by /discover (mode:"async"), report progress:
// { done, posts, perSub: [{ sub, status }] }. The client calls this on an
// interval and streams posts in as each subreddit's run finishes.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const progress = await pollApifySearchRuns(parsed.data.runs, parsed.data.limit ?? 25);
  return NextResponse.json(progress);
}
