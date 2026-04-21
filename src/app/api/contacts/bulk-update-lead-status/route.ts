import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveContactIdsByFilters, type ContactFilters } from "@/lib/contacts-filter";

const VALID_LEAD_STATUSES = ["new", "contacted", "qualified", "customer", "churned"] as const;
type LeadStatus = typeof VALID_LEAD_STATUSES[number];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { contactIds, filters, workspaceId, lead_status } = body as {
    contactIds?: string[];
    filters?: ContactFilters;
    workspaceId: string;
    lead_status: string;
  };

  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  if (!lead_status || !VALID_LEAD_STATUSES.includes(lead_status as LeadStatus)) {
    return NextResponse.json({ error: "Invalid lead_status" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let ids: string[];
  if (filters) {
    ids = await resolveContactIdsByFilters(supabase, workspaceId, filters, 5000);
  } else if (Array.isArray(contactIds) && contactIds.length > 0) {
    ids = contactIds;
  } else {
    return NextResponse.json({ error: "Missing contactIds or filters" }, { status: 400 });
  }

  if (ids.length === 0) return NextResponse.json({ updated: 0 });

  const { error } = await supabase
    .from("contacts")
    .update({ lead_status: lead_status as LeadStatus })
    .in("id", ids)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ updated: ids.length });
}
