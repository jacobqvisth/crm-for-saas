import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import {
  DEFAULT_TOPIC,
  DISTRIBUTION_SEED,
  type DistributionRec,
} from "@/lib/forums/distribution";

// GET /api/forums/distribution?topic=... → { recs: DistributionRec[] }
// All recommendations for the workspace + topic, in posting order. If the
// workspace has none yet for this topic, seed the curated list first so the
// board is populated on first visit; tracking state then lives on the rows.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const topic = request.nextUrl.searchParams.get("topic") || DEFAULT_TOPIC;

  const { data: existing, error: readErr } = await supabase
    .from("forum_distribution")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic", topic)
    .order("sort_order", { ascending: true });
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  if (existing && existing.length > 0) {
    // Self-heal rows seeded before suggested_body existed: backfill the body
    // from the code seed (matched by subreddit) so old boards aren't title-only.
    const recs = existing as unknown as DistributionRec[];
    const missing = recs.filter((r) => r.suggested_body == null);
    for (const row of missing) {
      const seed = DISTRIBUTION_SEED.find(
        (s) => s.topic === row.topic && s.subreddit === row.subreddit,
      );
      if (seed?.suggested_body) {
        await supabase
          .from("forum_distribution")
          .update({ suggested_body: seed.suggested_body })
          .eq("id", row.id)
          .eq("workspace_id", workspaceId);
        row.suggested_body = seed.suggested_body;
      }
    }
    return NextResponse.json({ recs });
  }

  // First visit for this topic — seed the curated recommendations.
  const seed = DISTRIBUTION_SEED.filter((r) => r.topic === topic).map((r) => ({
    ...r,
    workspace_id: workspaceId,
  }));
  if (seed.length === 0) {
    return NextResponse.json({ recs: [] });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("forum_distribution")
    .insert(seed)
    .select();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const recs = ((inserted ?? []) as unknown as DistributionRec[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  return NextResponse.json({ recs });
}
