import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/videos/server";
import { SEED_VIDEOS } from "@/lib/videos/seed";
import type { DiagnosticVideo } from "@/lib/videos/types";

// GET /api/videos → { videos: DiagnosticVideo[] }
//
// The curated list in src/lib/videos/seed.ts is the source of truth. On every
// load we reconcile the workspace's rows against it:
//   • insert any seed videos that aren't in the DB yet (keyed on youtube_id)
//   • prune rows that are no longer in the seed AND haven't been marked or
//     worked on (no summary / no prompt), so retiring a video from the list
//     clears it from the page without touching anything the user cares about.
// Marked / summarized rows are always preserved, even if dropped from the seed.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data: existing } = await supabase
    .from("diagnostic_videos")
    .select("*")
    .eq("workspace_id", workspaceId);

  const seedIds = new Set(SEED_VIDEOS.map((v) => v.youtube_id));
  const existingIds = new Set((existing ?? []).map((v) => v.youtube_id));

  // Prune stale, un-worked rows that have left the curated list.
  const staleIds = (existing ?? [])
    .filter(
      (v) =>
        !seedIds.has(v.youtube_id) &&
        !v.marked &&
        !v.summary &&
        !v.veo3_prompt
    )
    .map((v) => v.id);
  if (staleIds.length > 0) {
    await supabase
      .from("diagnostic_videos")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("id", staleIds);
  }

  // Insert any seed videos not present yet.
  const toInsert = SEED_VIDEOS.filter((v) => !existingIds.has(v.youtube_id)).map(
    (v, i) => ({
      workspace_id: workspaceId,
      youtube_id: v.youtube_id,
      title: v.title,
      channel: v.channel,
      url: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      category: v.category,
      dtc_codes: v.dtc_codes,
      description: v.description,
      sort_order: i,
    })
  );
  if (toInsert.length > 0) {
    const { error } = await supabase.from("diagnostic_videos").insert(toInsert);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: videos, error } = await supabase
    .from("diagnostic_videos")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ videos: (videos ?? []) as DiagnosticVideo[] });
}
