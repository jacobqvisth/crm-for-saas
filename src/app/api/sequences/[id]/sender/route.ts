import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the sequence belongs to a workspace the user has access to (RLS handles this)
  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, workspace_id")
    .eq("id", sequenceId)
    .single();

  if (seqError || !sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const body = await request.json();
  const { senderAccountId, scope } = body as {
    senderAccountId: string;
    scope: "future" | "all";
  };

  if (!senderAccountId || !scope) {
    return NextResponse.json(
      { error: "Missing required fields: senderAccountId, scope" },
      { status: 400 }
    );
  }

  if (scope !== "future" && scope !== "all") {
    return NextResponse.json(
      { error: "scope must be 'future' or 'all'" },
      { status: 400 }
    );
  }

  // Verify the target gmail account belongs to this workspace and is active
  const { data: gmailAccount, error: gmailError } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, status")
    .eq("id", senderAccountId)
    .eq("workspace_id", sequence.workspace_id)
    .single();

  if (gmailError || !gmailAccount) {
    return NextResponse.json(
      { error: "Gmail account not found in this workspace" },
      { status: 404 }
    );
  }

  if (gmailAccount.status !== "active") {
    return NextResponse.json(
      { error: "Gmail account is not active" },
      { status: 422 }
    );
  }

  // Get all enrollment IDs for this sequence
  const { data: enrollments } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", sequenceId);

  if (!enrollments || enrollments.length === 0) {
    return NextResponse.json({ enrollmentsUpdated: 0, queueUpdated: 0 });
  }

  const enrollmentIds = enrollments.map((e) => e.id);

  // Update all enrollments' sender_account_id
  const { count: enrollmentsUpdated } = await supabase
    .from("sequence_enrollments")
    .update({ sender_account_id: senderAccountId })
    .in("id", enrollmentIds);

  // Update email_queue rows — always include 'scheduled'; include 'sent' if scope is 'all'
  // Never touch rows with status 'sending' (mid-flight) or 'failed'/'cancelled'
  type QueueStatus = "pending" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  const queueStatuses: QueueStatus[] =
    scope === "all" ? ["scheduled", "sent"] : ["scheduled"];

  const { count: queueUpdated } = await supabase
    .from("email_queue")
    .update({ sender_account_id: senderAccountId })
    .in("enrollment_id", enrollmentIds)
    .in("status", queueStatuses);

  return NextResponse.json({
    enrollmentsUpdated: enrollmentsUpdated ?? enrollmentIds.length,
    queueUpdated: queueUpdated ?? 0,
  });
}
