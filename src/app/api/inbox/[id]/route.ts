import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { is_read, category } = body as { is_read?: boolean; category?: string };

  // Verify the message exists and belongs to this user's workspace
  const { data: existing } = await supabase
    .from("inbox_messages")
    .select("id, contact_id, category")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (is_read !== undefined) updates.is_read = is_read;
  if (category !== undefined) updates.category = category;

  const { data, error } = await supabase
    .from("inbox_messages")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If category changed to 'interested' and we have a contact, qualify them
  if (category === "interested" && existing.contact_id) {
    await supabase
      .from("contacts")
      .update({ lead_status: "qualified" })
      .eq("id", existing.contact_id);
  }

  return NextResponse.json(data);
}
