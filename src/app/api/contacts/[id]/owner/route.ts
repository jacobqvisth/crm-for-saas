import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseOwnerBody, resolveManualOwners } from "@/lib/reps/owner";

/**
 * POST /api/contacts/[id]/owner
 *
 * Set the rep ownership for a contact.
 *  - { auto: true } → re-enable auto-assignment and recompute from activity.
 *  - { auto: false, primaryOwnerId, secondaryOwnerId } → lock to specific reps.
 *
 * RLS scopes every query to the caller's workspace.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = parseOwnerBody(await request.json().catch(() => null));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.auto) {
    const { error } = await supabase
      .from("contacts")
      .update({ owner_auto: true })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const { error: rpcErr } = await supabase.rpc("recompute_contact_owner", {
      p_contact_id: id,
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  } else {
    const resolved = await resolveManualOwners(supabase, parsed);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const { error } = await supabase
      .from("contacts")
      .update({
        owner_auto: false,
        primary_owner_id: resolved.primary,
        secondary_owner_id: resolved.secondary,
        primary_owner_source: "manual",
        owner_updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("contacts")
    .select(
      "id, primary_owner_id, secondary_owner_id, owner_auto, owner_updated_at, primary_owner_source",
    )
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contact: row });
}
