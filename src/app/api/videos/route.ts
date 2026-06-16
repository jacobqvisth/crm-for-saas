import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/videos/server";
import { SEED_VIDEOS } from "@/lib/videos/seed";
import { parseYouTubeId, extractDtcCodes } from "@/lib/videos/parse";
import type { DiagnosticVideo } from "@/lib/videos/types";

// GET /api/videos → { videos: DiagnosticVideo[] }
//
// The curated list in src/lib/videos/seed.ts is the source of truth for the
// seeded rows. On every load we reconcile the workspace's seed rows against it:
//   • insert any seed videos that aren't in the DB yet (keyed on youtube_id)
//   • prune seed rows no longer in the list that haven't been marked / worked on
// Manually-added rows (source = 'manual') and any marked / summarized row are
// always preserved.
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

  // Prune stale, un-worked SEED rows that have left the curated list.
  const staleIds = (existing ?? [])
    .filter(
      (v) =>
        v.source !== "manual" &&
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
      source: "seed",
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
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ videos: (videos ?? []) as DiagnosticVideo[] });
}

const postSchema = z.object({
  url: z.string().trim().min(1),
  category: z.string().trim().max(120).optional(),
  dtc_codes: z.array(z.string().trim().max(10)).max(20).optional(),
});

// POST /api/videos → add a video from a pasted YouTube link.
// Resolves the title + channel via YouTube oembed (which also validates the
// video exists), auto-detects any DTC codes in the title, and saves it as a
// manual row.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const youtubeId = parseYouTubeId(parsed.data.url);
  if (!youtubeId) {
    return NextResponse.json(
      { error: "That doesn't look like a YouTube link." },
      { status: 400 }
    );
  }

  // Validate + fetch metadata via oembed.
  let title: string;
  let channel: string;
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${youtubeId}`
      )}&format=json`,
      { cache: "no-store" }
    );
    if (!oembed.ok) {
      return NextResponse.json(
        { error: "Couldn't find that video on YouTube (it may be private or removed)." },
        { status: 400 }
      );
    }
    const data = (await oembed.json()) as { title?: string; author_name?: string };
    title = data.title?.trim() || "Untitled video";
    channel = data.author_name?.trim() || "Unknown channel";
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach YouTube to verify that link. Try again." },
      { status: 502 }
    );
  }

  // DTC codes: explicit list wins, else auto-detect from the title.
  const dtcCodes =
    parsed.data.dtc_codes && parsed.data.dtc_codes.length > 0
      ? Array.from(new Set(parsed.data.dtc_codes.map((c) => c.toUpperCase())))
      : extractDtcCodes(title);

  // Sort manual videos after everything currently on the page.
  const { data: maxRow } = await supabase
    .from("diagnostic_videos")
    .select("sort_order")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data: video, error } = await supabase
    .from("diagnostic_videos")
    .insert({
      workspace_id: workspaceId,
      youtube_id: youtubeId,
      title,
      channel,
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      category: parsed.data.category || null,
      dtc_codes: dtcCodes,
      source: "manual",
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error) {
    // Unique (workspace_id, youtube_id) violation → already on the page.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That video is already on the page." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ video: video as DiagnosticVideo }, { status: 201 });
}
