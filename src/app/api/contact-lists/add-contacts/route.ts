import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveContactIdsByFilters, type ContactFilters } from "@/lib/contacts-filter";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { contactIds, filters, workspaceId, listId } = body as {
    contactIds?: string[];
    filters?: ContactFilters;
    workspaceId: string;
    listId: string;
  };

  if (!workspaceId || !listId) {
    return NextResponse.json({ error: "Missing workspaceId or listId" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Verify list belongs to workspace
  const { data: list } = await supabase
    .from("contact_lists")
    .select("id")
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  let ids: string[];
  if (filters) {
    ids = await resolveContactIdsByFilters(supabase, workspaceId, filters, 5000);
  } else if (Array.isArray(contactIds) && contactIds.length > 0) {
    ids = contactIds;
  } else {
    return NextResponse.json({ error: "Missing contactIds or filters" }, { status: 400 });
  }

  if (ids.length === 0) return NextResponse.json({ added: 0 });

  const rows = ids.map((contactId) => ({ list_id: listId, contact_id: contactId }));
  const { error } = await supabase
    .from("contact_list_members")
    .upsert(rows, { onConflict: "list_id,contact_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: ids.length });
}
