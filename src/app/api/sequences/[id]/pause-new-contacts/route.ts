import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNextSendTime } from "@/lib/sequences/scheduler";
import type { SequenceSettings } from "@/lib/database.types";

// Toggle "finish in-progress only" mode for a sequence.
//
// Body: { paused: boolean }
//   paused = true  -> set settings.pause_new_contacts = true and DEMOTE every
//                     not-yet-started contact's first email (current_step === 0)
//                     from 'scheduled' to 'pending', so the cron stops sending
//                     to new contacts. Follow-ups (current_step >= 1) are left
//                     alone and keep flowing.
//   paused = false -> set the flag false and PROMOTE those held first emails
//                     ('pending' -> 'scheduled' with a fresh send time) so new
//                     contacts start receiving their first email again.
//
// The cron (process-emails) also enforces the flag at send time, so a first
// email queued after this call (e.g. a freshly enrolled contact) is demoted on
// its next pass. This endpoint just makes the toggle take effect immediately.
//
// Large sequences: paginate past the 1k row cap and chunk the .in() updates,
// same pattern as resume-all / the activation promote in PATCH.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const paused = Boolean((body as { paused?: boolean }).paused);

  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, workspace_id, settings")
    .eq("id", sequenceId)
    .single();

  if (seqError || !sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  // Workspace membership check.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", sequence.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = (sequence.settings ?? {}) as SequenceSettings;
  const newSettings: SequenceSettings = { ...settings, pause_new_contacts: paused };

  const { error: updateError } = await supabase
    .from("sequences")
    .update({ settings: newSettings })
    .eq("id", sequenceId)
    .eq("workspace_id", sequence.workspace_id);
  if (updateError) {
    return NextResponse.json({ error: "Failed to update sequence" }, { status: 500 });
  }

  // Collect the not-yet-started enrollments (first email never sent).
  const PAGE = 1000;
  const notStartedIds: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id, current_step")
      .eq("sequence_id", sequenceId)
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: "Failed to read enrollments" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const e of data) if ((e.current_step ?? 0) === 0) notStartedIds.push(e.id);
    if (data.length < PAGE) break;
  }

  const CHUNK = 200;
  let affected = 0;

  if (paused) {
    // Demote queued first emails out of the send pool.
    for (let i = 0; i < notStartedIds.length; i += CHUNK) {
      const chunk = notStartedIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("email_queue")
        .update({ status: "pending" as const })
        .in("enrollment_id", chunk)
        .eq("status", "scheduled")
        .select("id");
      if (error) {
        return NextResponse.json({ error: "Failed to hold first emails" }, { status: 500 });
      }
      affected += data?.length ?? 0;
    }
  } else {
    // Promote held first emails back to scheduled with a fresh send time.
    const scheduledFor = getNextSendTime(newSettings).toISOString();
    for (let i = 0; i < notStartedIds.length; i += CHUNK) {
      const chunk = notStartedIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("email_queue")
        .update({ status: "scheduled" as const, scheduled_for: scheduledFor })
        .in("enrollment_id", chunk)
        .eq("status", "pending")
        .select("id");
      if (error) {
        return NextResponse.json({ error: "Failed to resume first emails" }, { status: 500 });
      }
      affected += data?.length ?? 0;
    }
  }

  return NextResponse.json({ success: true, paused, affected });
}
