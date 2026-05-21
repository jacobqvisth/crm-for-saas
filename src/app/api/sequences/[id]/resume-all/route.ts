import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNextSendTime } from "@/lib/sequences/scheduler";
import type { SequenceSettings } from "@/lib/database.types";

// Symmetric inverse of POST /api/sequences/[id]/pause-all.
//
// pause-all does two things:
//   1. sequence_enrollments.status: active → paused
//   2. email_queue.status: scheduled → cancelled
//
// Before this endpoint existed, the only "resume" path was PATCH /api/sequences/[id]
// with { status: 'active' }, which flips the sequence row but does NOT touch
// enrollments or revive cancelled queue rows. So a Pause→Resume click cycle
// silently broke 4 sequences (~3k enrollments) — they ended up zombie state
// (sequence active, enrollments active, queue all cancelled, cron idle).
//
// This endpoint reverses both writes:
//   1. paused enrollments → active
//   2. for any enrollment now active without a live scheduled row, revive its
//      LATEST cancelled queue row → status=scheduled, scheduled_for=next window.
//      The latest row is the right one because pause-all only cancels rows in
//      'scheduled' state, and an enrollment can hold at most one scheduled row
//      at a time (advancing creates a new row after the previous one sends).
export async function POST(
  _request: NextRequest,
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

  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, workspace_id, status, settings")
    .eq("id", sequenceId)
    .single();

  if (seqError || !sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const settings = sequence.settings as SequenceSettings;
  const nextWindow = getNextSendTime(settings).toISOString();

  // 1. Reactivate paused enrollments (covers status='paused' and 'company_paused').
  //    Page through to dodge the 1k row cap, then update in chunks.
  const pausedIds: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id")
      .eq("sequence_id", sequenceId)
      .in("status", ["paused", "company_paused"])
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: "Failed to read enrollments" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    pausedIds.push(...data.map((e) => e.id));
    if (data.length < PAGE) break;
  }

  const CHUNK = 200;
  let reactivated = 0;
  for (let i = 0; i < pausedIds.length; i += CHUNK) {
    const chunk = pausedIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("sequence_enrollments")
      .update({ status: "active" })
      .in("id", chunk);
    if (error) {
      return NextResponse.json({ error: "Failed to reactivate enrollments" }, { status: 500 });
    }
    reactivated += chunk.length;
  }

  // 2. Revive cancelled queue rows for any active enrollment that currently
  //    has no scheduled row. We do this for ALL active enrollments in the
  //    sequence (not just the ones we just reactivated) because a previous
  //    asymmetric pause/resume cycle may have left some enrollments in
  //    zombie state (active enrollment, all cancelled queue rows).
  const activeIds: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id")
      .eq("sequence_id", sequenceId)
      .eq("status", "active")
      .range(offset, offset + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: "Failed to read active enrollments" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    activeIds.push(...data.map((e) => e.id));
    if (data.length < PAGE) break;
  }

  // Of the active enrollments, find which already have a scheduled row.
  const liveSet = new Set<string>();
  for (let i = 0; i < activeIds.length; i += CHUNK) {
    const chunk = activeIds.slice(i, i + CHUNK);
    const { data: rows } = await supabase
      .from("email_queue")
      .select("enrollment_id")
      .in("enrollment_id", chunk)
      .eq("status", "scheduled");
    for (const r of rows || []) if (r.enrollment_id) liveSet.add(r.enrollment_id);
  }
  const stuckIds = activeIds.filter((id) => !liveSet.has(id));

  // For each stuck enrollment, locate the LATEST cancelled queue row.
  const reviveIds: string[] = [];
  for (let i = 0; i < stuckIds.length; i += CHUNK) {
    const chunk = stuckIds.slice(i, i + CHUNK);
    const { data: rows } = await supabase
      .from("email_queue")
      .select("id, enrollment_id, created_at")
      .in("enrollment_id", chunk)
      .eq("status", "cancelled");
    const byEnroll = new Map<string, { id: string; created_at: string }>();
    for (const r of rows || []) {
      if (!r.enrollment_id || !r.created_at) continue;
      const prev = byEnroll.get(r.enrollment_id);
      if (!prev || new Date(r.created_at) > new Date(prev.created_at)) {
        byEnroll.set(r.enrollment_id, { id: r.id, created_at: r.created_at });
      }
    }
    for (const id of chunk) {
      const hit = byEnroll.get(id);
      if (hit) reviveIds.push(hit.id);
    }
  }

  let revived = 0;
  for (let i = 0; i < reviveIds.length; i += CHUNK) {
    const chunk = reviveIds.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("email_queue")
      .update({
        status: "scheduled" as const,
        scheduled_for: nextWindow,
      })
      .in("id", chunk);
    if (error) {
      return NextResponse.json({ error: "Failed to revive queue rows" }, { status: 500 });
    }
    revived += chunk.length;
  }

  // 3. Make sure the sequence itself is active. We don't gate the endpoint on
  //    the current sequence.status — the symmetric pair to pause-all leaves
  //    `sequences.status` untouched (only the dropdown/PATCH path changes it),
  //    so re-flipping here is a no-op when the sequence was never paused.
  if (sequence.status !== "active") {
    await supabase
      .from("sequences")
      .update({ status: "active" })
      .eq("id", sequenceId)
      .eq("workspace_id", sequence.workspace_id);
  }

  return NextResponse.json({
    success: true,
    reactivated,
    revived,
    next_send: nextWindow,
  });
}
