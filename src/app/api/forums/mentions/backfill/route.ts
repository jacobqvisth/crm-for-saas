import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace } from "@/lib/forums/server";
import { detectWrenchlane, wrenchlaneExcerpt } from "@/lib/forums/wl-domains";

// POST /api/forums/mentions/backfill
//
// Seeds reddit_mentions with our OWN Wrenchlane footprint: every posted forum
// item (generated post, distribution placement, answer reply) whose content
// links to or names Wrenchlane becomes an audience='us' row. No external calls.
//
// Idempotent — clears the derived audience='us' rows and rebuilds them, so it's
// safe to re-run after new posts go out. Third-party detection is a separate
// scan job (next phase); it only writes audience='third_party', which this
// route never touches.
export async function POST() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const raw = supabase as unknown as SupabaseClient;

  type Row = {
    source_url: string;
    text: string;
    subreddit: string | null;
    author: string | null;
    account_id: string | null;
  };
  const rows: Row[] = [];

  const [posts, dist, replies] = await Promise.all([
    supabase
      .from("forum_posts")
      .select("generated_title, generated_body, posted_url, forum_target, assigned_account_id")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null),
    raw
      .from("forum_distribution")
      .select("suggested_title, suggested_body, suggested_comment, posted_url, subreddit, posted_by_username, posted_by_account_id")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null),
    raw
      .from("forum_replies")
      .select("generated_body, posted_url, source_subreddit, posted_by_username, posted_by_account_id")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null),
  ]);

  for (const p of (posts.data ?? []) as Record<string, unknown>[]) {
    rows.push({
      source_url: String(p.posted_url),
      text: `${p.generated_title ?? ""}\n${p.generated_body ?? ""}`,
      subreddit: typeof p.forum_target === "string" ? p.forum_target.replace(/^reddit:/i, "") : null,
      author: null,
      account_id: (p.assigned_account_id as string) ?? null,
    });
  }
  for (const d of (dist.data ?? []) as Record<string, unknown>[]) {
    rows.push({
      source_url: String(d.posted_url),
      text: `${d.suggested_title ?? ""}\n${d.suggested_body ?? ""}\n${d.suggested_comment ?? ""}`,
      subreddit: (d.subreddit as string) ?? null,
      author: (d.posted_by_username as string) ?? null,
      account_id: (d.posted_by_account_id as string) ?? null,
    });
  }
  for (const r of (replies.data ?? []) as Record<string, unknown>[]) {
    rows.push({
      source_url: String(r.posted_url),
      text: String(r.generated_body ?? ""),
      subreddit: (r.source_subreddit as string) ?? null,
      author: (r.posted_by_username as string) ?? null,
      account_id: (r.posted_by_account_id as string) ?? null,
    });
  }

  const detected = rows
    .map((row) => {
      const hit = detectWrenchlane(row.text);
      if (!hit) return null;
      return {
        workspace_id: workspaceId,
        kind: hit.kind,
        audience: "us" as const,
        source_url: row.source_url,
        subreddit: row.subreddit,
        author: row.author,
        account_id: row.account_id,
        matched_domain: hit.matchedDomain,
        excerpt: wrenchlaneExcerpt(row.text),
        is_comment: false,
        status: "confirmed" as const, // our own posts need no review
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Rebuild the derived "us" set. (Never deletes third_party rows.)
  const del = await raw
    .from("reddit_mentions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("audience", "us");
  if (del.error) {
    return NextResponse.json(
      { error: "reddit_mentions table not ready — apply the migration first", detail: del.error.message },
      { status: 503 },
    );
  }

  if (detected.length > 0) {
    const ins = await raw.from("reddit_mentions").insert(detected);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scannedPosted: rows.length,
    seeded: detected.length,
    breakdown: {
      links: detected.filter((d) => d.kind === "link").length,
      mentions: detected.filter((d) => d.kind === "plaintext").length,
    },
  });
}
