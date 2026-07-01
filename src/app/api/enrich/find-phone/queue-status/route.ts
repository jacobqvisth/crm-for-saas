import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Live counts for the "finding in background" progress UI.
export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const base = () =>
    supabase
      .from("phone_enrichment_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();

  const [queued, processing, doneRecent, foundRecent] = await Promise.all([
    base().eq("status", "queued"),
    base().eq("status", "processing"),
    base().eq("status", "done").gte("finished_at", since),
    base().eq("status", "done").eq("outcome", "found").gte("finished_at", since),
  ]);

  return NextResponse.json({
    queued: queued.count ?? 0,
    processing: processing.count ?? 0,
    doneRecently: doneRecent.count ?? 0,
    foundRecently: foundRecent.count ?? 0,
  });
}
