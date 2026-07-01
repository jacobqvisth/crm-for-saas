import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Skip contacts searched within this window unless the caller forces a re-run.
const RECENT_DAYS = 14;
// Don't let one click enqueue an unbounded number of jobs.
const MAX_ENQUEUE = 500;

// Queue contacts for background phone enrichment. Returns immediately — a cron
// worker drains the queue and saves numbers as they're found, so the user can
// leave the page.
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { workspaceId, contactIds, force } = body as {
    workspaceId: string;
    contactIds?: string[];
    force?: boolean;
  };

  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "Missing contactIds" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ids = Array.from(new Set(contactIds)).slice(0, MAX_ENQUEUE);

  // Filter: only number-less contacts, and (unless forced) not recently searched.
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, phone, phone_searched_at")
    .eq("workspace_id", workspaceId)
    .in("id", ids);

  const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
  const eligible: string[] = [];
  let skippedRecent = 0;
  let skippedHasPhone = 0;
  for (const c of contacts ?? []) {
    if (c.phone) {
      skippedHasPhone++;
      continue;
    }
    const searchedAt = c.phone_searched_at as string | null;
    if (!force && searchedAt && new Date(searchedAt).getTime() > cutoff) {
      skippedRecent++;
      continue;
    }
    eligible.push(c.id as string);
  }

  // Exclude contacts that already have an open job (a re-enqueue is a no-op).
  let skippedOpen = 0;
  let toInsert = eligible;
  if (eligible.length) {
    const { data: openJobs } = await supabase
      .from("phone_enrichment_jobs")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "processing"])
      .in("contact_id", eligible);
    const open = new Set((openJobs ?? []).map((j) => j.contact_id as string));
    skippedOpen = open.size;
    toInsert = eligible.filter((id) => !open.has(id));
  }

  let queued = 0;
  if (toInsert.length) {
    const rows = toInsert.map((contact_id) => ({
      workspace_id: workspaceId,
      contact_id,
      requested_by: user.id,
      status: "queued",
    }));
    const { error, count } = await supabase
      .from("phone_enrichment_jobs")
      .insert(rows, { count: "exact" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    queued = count ?? toInsert.length;
  }

  return NextResponse.json({ queued, skippedRecent, skippedHasPhone, skippedOpen });
}
