import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/videos/server";
import { SEED_VIDEOS } from "@/lib/videos/seed";
import type { DiagnosticVideo } from "@/lib/videos/types";

// GET /api/videos → { videos: DiagnosticVideo[] }
//
// On a workspace's first visit (no rows yet) the 10 curated videos from
// src/lib/videos/seed.ts are inserted so the gallery renders immediately.
export async function GET() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  let { data: videos } = await supabase
    .from("diagnostic_videos")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true });

  if (!videos || videos.length === 0) {
    const rows = SEED_VIDEOS.map((v, i) => ({
      workspace_id: workspaceId,
      youtube_id: v.youtube_id,
      title: v.title,
      channel: v.channel,
      url: `https://www.youtube.com/watch?v=${v.youtube_id}`,
      category: v.category,
      description: v.description,
      sort_order: i,
    }));

    const { data: seeded, error } = await supabase
      .from("diagnostic_videos")
      .insert(rows)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    videos = seeded ?? [];
  }

  return NextResponse.json({ videos: videos as DiagnosticVideo[] });
}
