import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { apifyCheckSubredditAccess, isApifyConfigured } from "@/lib/forums/reddit-apify";

// The Apify community scrape can cold-start and take a while.
export const maxDuration = 300;

const clean = (s: string) => s.replace(/^\/?r\//i, "").trim().toLowerCase();

// GET /api/forums/subreddit-access?subs=ase,mechanicadvice
// Read the cached access for a set of subreddits. Never runs a scrape — returns
// only what's already been checked; unknown/unchecked subs are simply absent.
export async function GET(req: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase } = ws;

  const raw = req.nextUrl.searchParams.get("subs") ?? "";
  const subs = Array.from(new Set(raw.split(",").map(clean).filter(Boolean)));
  if (subs.length === 0) return NextResponse.json({ access: {} });

  const { data, error } = await supabase
    .from("subreddit_access")
    .select("subreddit, access, title, checked_at")
    .in("subreddit", subs);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const access: Record<string, { access: string; title: string | null; checked_at: string }> = {};
  for (const row of data ?? []) {
    access[row.subreddit] = {
      access: row.access,
      title: row.title,
      checked_at: row.checked_at,
    };
  }
  return NextResponse.json({ access });
}

const checkSchema = z.object({ sub: z.string().min(1).max(100) });

// POST /api/forums/subreddit-access { sub } → runs the live check and caches it.
// A failed/timed-out scrape returns access "unknown" and does NOT overwrite a
// previously known value (so a transient error can't flip "open" to a false
// "members_only").
export async function POST(req: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase } = ws;

  if (!isApifyConfigured()) {
    return NextResponse.json(
      { error: "Reddit reads aren't configured (APIFY_TOKEN missing)." },
      { status: 400 },
    );
  }

  const parsed = checkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const sub = clean(parsed.data.sub);
  if (!sub) return NextResponse.json({ error: "Invalid subreddit" }, { status: 400 });

  const result = await apifyCheckSubredditAccess(sub);

  if (!result.ok) {
    // Couldn't read it this time — keep any previously cached value.
    const { data: existing } = await supabase
      .from("subreddit_access")
      .select("subreddit, access, title, checked_at")
      .eq("subreddit", sub)
      .maybeSingle();
    return NextResponse.json({
      subreddit: sub,
      access: existing?.access ?? "unknown",
      title: existing?.title ?? null,
      checked_at: existing?.checked_at ?? null,
      stale: true,
    });
  }

  const row = {
    subreddit: sub,
    access: result.access,
    title: result.title,
    checked_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("subreddit_access").upsert(row, { onConflict: "subreddit" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(row);
}
