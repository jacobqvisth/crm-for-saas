import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { enrichMention } from "@/lib/forums/mention-enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/forums/mentions/enrich
//
// Processes third-party reddit_mentions that don't have an AI verdict yet
// (is_about_us IS NULL) — the ones the scan's per-run cap skipped, or where
// enrichment failed. Sets sentiment/context/summary and auto-dismisses noise
// (is_about_us=false). Same CRON_SECRET/SYNC_SECRET bearer as the other crons
// (it spends Anthropic tokens). Safe to run repeatedly.
function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || request.headers.get("x-sync-secret");
  if (!syncSecret && !cronSecret) return process.env.NODE_ENV !== "production";
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient() as unknown as SupabaseClient;

  const { data, error } = await supabase
    .from("reddit_mentions")
    .select("id, subreddit, author, excerpt")
    .eq("workspace_id", SHARED_FORUMS_WORKSPACE_ID)
    .eq("audience", "third_party")
    .is("is_about_us", null)
    .limit(50);
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 503 });

  const rows = (data ?? []) as { id: string; subreddit: string | null; author: string | null; excerpt: string | null }[];
  let enriched = 0;
  let dismissed = 0;
  for (const r of rows) {
    const res = await enrichMention({ subreddit: r.subreddit, author: r.author, text: r.excerpt ?? "" });
    if (!res.ok) continue;
    const e = res.enrichment;
    await supabase
      .from("reddit_mentions")
      .update({
        sentiment: e.sentiment,
        context_tag: e.contextTag,
        ai_summary: e.summary,
        is_about_us: e.isAboutUs,
        status: e.isAboutUs ? "new" : "dismissed",
      })
      .eq("id", r.id);
    enriched++;
    if (!e.isAboutUs) dismissed++;
  }

  return NextResponse.json({ ok: true, scanned: rows.length, enriched, dismissed });
}
