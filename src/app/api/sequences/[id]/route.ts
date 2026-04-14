import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Note: A future migration could add ON DELETE CASCADE to the FKs below
// (email_queue → sequence_enrollments, sequence_steps → sequences, etc.)
// to simplify this handler. For now we delete in explicit FK order.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  // Auth check — RLS also enforces workspace ownership
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch the sequence (RLS ensures it belongs to user's workspace)
  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, name, status, workspace_id")
    .eq("id", sequenceId)
    .single();

  if (seqError || !sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  // Safety: refuse delete if sequence is active and has live enrollments.
  // Deleting mid-flight would orphan scheduled email_queue items.
  if (sequence.status === "active") {
    const { count } = await supabase
      .from("sequence_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "active");

    if (count && count > 0) {
      return NextResponse.json(
        {
          error:
            "Pause the sequence and wait for enrollments to finish before deleting, or archive instead.",
        },
        { status: 400 }
      );
    }
  }

  // Log an activity trail before deletion (sequence row will no longer exist after)
  await supabase.from("activities").insert({
    workspace_id: sequence.workspace_id,
    type: "system",
    subject: `Sequence deleted: ${sequence.name}`,
    user_id: user.id,
  });

  // Step 1: Gather enrollment IDs so we can clean up related tables
  const { data: enrollments } = await supabase
    .from("sequence_enrollments")
    .select("id")
    .eq("sequence_id", sequenceId);

  const enrollmentIds = (enrollments ?? []).map((e) => e.id);

  if (enrollmentIds.length > 0) {
    // Step 1a: Gather email_queue IDs for this sequence
    const { data: queueItems } = await supabase
      .from("email_queue")
      .select("id")
      .in("enrollment_id", enrollmentIds);

    const queueIds = (queueItems ?? []).map((q) => q.id);

    if (queueIds.length > 0) {
      // Step 1b: Delete email_events (FK → email_queue)
      const { error: eventsError } = await supabase
        .from("email_events")
        .delete()
        .in("email_queue_id", queueIds);

      if (eventsError) {
        return NextResponse.json(
          { error: "Failed to delete email events" },
          { status: 500 }
        );
      }

      // Step 1c: Nullify inbox_messages.email_queue_id to preserve reply history
      // (inbox_messages.email_queue_id is nullable, so we just unlink rather than delete)
      await supabase
        .from("inbox_messages")
        .update({ email_queue_id: null })
        .in("email_queue_id", queueIds);

      // Step 2: Delete email_queue
      const { error: queueError } = await supabase
        .from("email_queue")
        .delete()
        .in("enrollment_id", enrollmentIds);

      if (queueError) {
        return NextResponse.json(
          { error: "Failed to delete email queue" },
          { status: 500 }
        );
      }
    }

    // Step 3: Delete sequence_enrollments
    const { error: enrollError } = await supabase
      .from("sequence_enrollments")
      .delete()
      .eq("sequence_id", sequenceId);

    if (enrollError) {
      return NextResponse.json(
        { error: "Failed to delete enrollments" },
        { status: 500 }
      );
    }
  }

  // Step 4: Delete sequence_steps
  const { error: stepsError } = await supabase
    .from("sequence_steps")
    .delete()
    .eq("sequence_id", sequenceId);

  if (stepsError) {
    return NextResponse.json(
      { error: "Failed to delete sequence steps" },
      { status: 500 }
    );
  }

  // Step 5: Delete the sequence itself
  const { error: seqDeleteError } = await supabase
    .from("sequences")
    .delete()
    .eq("id", sequenceId);

  if (seqDeleteError) {
    return NextResponse.json(
      { error: "Failed to delete sequence" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
