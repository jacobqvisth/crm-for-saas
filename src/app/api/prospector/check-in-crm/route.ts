import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: { personIds: string[]; linkedinUrls: string[]; workspaceId: string } =
    await request.json();
  const { personIds, linkedinUrls, workspaceId } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inCrmPersonIds = new Set<string>();

  // Check 1: placeholder email pattern
  const placeholderEmails = personIds.map(
    (id) => `prospector_noemail_${id}@placeholder.invalid`
  );
  const { data: byEmail } = await supabase
    .from("contacts")
    .select("email")
    .eq("workspace_id", workspaceId)
    .in("email", placeholderEmails);

  for (const row of byEmail || []) {
    const match = row.email?.match(
      /^prospector_noemail_(.+)@placeholder\.invalid$/
    );
    if (match?.[1]) inCrmPersonIds.add(match[1]);
  }

  // Check 2: linkedin_url match
  const validLinkedinUrls = linkedinUrls.filter(Boolean);
  if (validLinkedinUrls.length > 0) {
    const { data: byLinkedin } = await supabase
      .from("contacts")
      .select("linkedin_url")
      .eq("workspace_id", workspaceId)
      .in("linkedin_url", validLinkedinUrls);

    for (const row of byLinkedin || []) {
      if (!row.linkedin_url) continue;
      const idx = linkedinUrls.indexOf(row.linkedin_url);
      if (idx !== -1 && personIds[idx]) {
        inCrmPersonIds.add(personIds[idx]);
      }
    }
  }

  return NextResponse.json({ inCrmIds: Array.from(inCrmPersonIds) });
}
