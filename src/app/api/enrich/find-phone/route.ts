import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPhonesForRecord } from "@/lib/enrich/find-phone-for-contact";

// Website discovery + scraping + web search can take a while.
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, contactId, companyId } = body as {
    workspaceId: string;
    contactId?: string;
    companyId?: string;
  };

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!contactId && !companyId) {
    return NextResponse.json({ error: "Missing contactId or companyId" }, { status: 400 });
  }

  // Workspace membership check
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await findPhonesForRecord(supabase, { workspaceId, contactId, companyId });
  return NextResponse.json(result);
}
