import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { scanGapCandidates, type GapScanPost } from "@/lib/forums/gap-scan";

// One Claude call per post (capped in the scan lib), so give it room. This runs
// on posts already fetched by /replies/discover — it does NOT scrape Reddit.
export const maxDuration = 120;

const bodySchema = z.object({
  posts: z
    .array(
      z.object({
        url: z.string().max(2000),
        subreddit: z.string().max(200).nullable().optional(),
        title: z.string().max(4000),
        body: z.string().max(20000).nullable().optional(),
        author: z.string().max(200).nullable().optional(),
        score: z.number().nullable().optional(),
        num_comments: z.number().nullable().optional(),
      }),
    )
    .max(100),
});

// POST /api/forums/gaps/scan
// Classify already-scraped Answer-posts results for AI-failure cases and persist
// the real ones as gap candidates. Body: { posts }. Returns { ok, found,
// skippedOwn, skippedCapped, candidates, ... }.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const posts: GapScanPost[] = parsed.data.posts.map((p) => ({
    url: p.url,
    subreddit: p.subreddit ?? null,
    title: p.title,
    body: p.body ?? null,
    author: p.author ?? null,
    score: p.score ?? null,
    num_comments: p.num_comments ?? null,
  }));

  const result = await scanGapCandidates({ supabase, workspaceId, posts });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Scan failed", ...result }, { status: 502 });
  }
  return NextResponse.json(result);
}
