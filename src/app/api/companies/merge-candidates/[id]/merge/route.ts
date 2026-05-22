import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { mergeCompanies } from "@/lib/wl-sync/merge-companies";

export const runtime = "nodejs";

const Body = z.object({
  keepId: z.string().uuid(),
  dropId: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: candidateRowId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { keepId, dropId } = parsed.data;

  // Verify the candidate row exists, is pending, and references exactly the
  // pair the client is trying to merge.
  const { data: candidate, error: candErr } = await supabase
    .from("company_merge_candidates")
    .select(
      "id, workspace_id, primary_company_id, candidate_company_id, status",
    )
    .eq("id", candidateRowId)
    .maybeSingle();
  if (candErr) {
    return NextResponse.json({ error: candErr.message }, { status: 500 });
  }
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
  if (candidate.status !== "pending") {
    return NextResponse.json(
      { error: `Candidate already ${candidate.status}` },
      { status: 409 },
    );
  }
  const pair = new Set([
    candidate.primary_company_id,
    candidate.candidate_company_id,
  ]);
  if (!pair.has(keepId) || !pair.has(dropId)) {
    return NextResponse.json(
      { error: "keepId/dropId must match the candidate row" },
      { status: 400 },
    );
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", candidate.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await mergeCompanies(supabase, {
      keepId,
      dropId,
      candidateRowId,
      reviewerUserId: user.id,
    });
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
