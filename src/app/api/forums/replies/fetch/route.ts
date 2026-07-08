import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { fetchRedditPost, isRedditConfigured } from "@/lib/forums/reddit";

const bodySchema = z.object({ url: z.string().min(1).max(2000) });

// POST /api/forums/replies/fetch → { post } | { error, redditConfigured }
// Pull a pasted Reddit post's title + body so we can show it and draft a reply.
// When it can't be fetched (no creds / Reddit 403), the UI falls back to a
// manual paste of the title + body.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await fetchRedditPost(parsed.data.url);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, redditConfigured: isRedditConfigured() },
      { status: 502 },
    );
  }
  return NextResponse.json({ post: result.post });
}
