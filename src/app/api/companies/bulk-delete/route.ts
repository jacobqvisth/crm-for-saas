import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdsByFilters, type CompanyFilters } from "@/lib/companies-filter";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { companyIds, filters, workspaceId } = body as {
    companyIds?: string[];
    filters?: CompanyFilters;
    workspaceId: string;
  };

  if (!workspaceId) return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let ids: string[];
  if (filters) {
    ids = await resolveCompanyIdsByFilters(supabase, workspaceId, filters, 5000);
  } else if (Array.isArray(companyIds) && companyIds.length > 0) {
    ids = companyIds;
  } else {
    return NextResponse.json({ error: "Missing companyIds or filters" }, { status: 400 });
  }

  if (ids.length === 0) return NextResponse.json({ deleted: 0 });

  const { error } = await supabase
    .from("companies")
    .delete()
    .in("id", ids)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: ids.length });
}
