import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  // Verify user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the sequence belongs to a workspace the user has access to
  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, workspace_id")
    .eq("id", sequenceId)
    .single();

  if (seqError || !sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  // Find all active enrollments in this sequence
  const { data: activeEnrollments } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", sequenceId)
    .eq("status", "active");

  if (!activeEnrollments || activeEnrollments.length === 0) {
    return NextResponse.json({ paused: 0, message: "No active enrollments to pause" });
  }

  const ids = activeEnrollments.map((e) => e.id);

  await supabase
    .from("sequence_enrollments")
    .update({ status: "paused" })
    .in("id", ids);

  await supabase
    .from("email_queue")
    .update({ status: "cancelled" as const })
    .in("enrollment_id", ids)
    .eq("status", "scheduled");

  return NextResponse.json({ success: true, paused: ids.length });
}
