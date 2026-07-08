import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { isRedditConfigured, searchRedditPosts } from "@/lib/forums/reddit";
import { REPLY_SUBREDDITS } from "@/lib/forums/replies";

// Reddit reads may run via an Apify scrape (residential IPs) which can take
// ~30-90s, so allow well past the default function timeout.
export const maxDuration = 120;

const ALLOWED = new Set(REPLY_SUBREDDITS.map((s) => s.name));

const bodySchema = z.object({
  subreddits: z.array(z.string()).optional(),
  query: z.string().max(300).optional(),
  sort: z.enum(["new", "hot", "relevance", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// POST /api/forums/replies/discover → { posts, redditConfigured }
// Find candidate posts to reply to across the diagnostic subreddits. Needs
// Reddit OAuth creds; when they're missing it returns redditConfigured:false so
// the UI can steer to the paste-a-URL flow instead.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const redditConfigured = isRedditConfigured();
  const requested = (parsed.data.subreddits ?? []).filter((s) => ALLOWED.has(s));
  const subreddits = requested.length > 0 ? requested : REPLY_SUBREDDITS.map((s) => s.name);

  const result = await searchRedditPosts({
    subreddits,
    query: parsed.data.query,
    sort: parsed.data.sort,
    limit: parsed.data.limit ?? 25,
  });

  if (!result.ok) {
    return NextResponse.json(
      { posts: [], redditConfigured, error: result.reason },
      { status: redditConfigured ? 502 : 200 },
    );
  }
  return NextResponse.json({ posts: result.posts, redditConfigured });
}
