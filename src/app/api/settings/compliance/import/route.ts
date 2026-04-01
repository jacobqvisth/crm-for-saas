import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    workspaceId,
    emails,
    reason = "dnclist",
    source = "CSV import",
  }: {
    workspaceId: string;
    emails: string[];
    reason?: string;
    source?: string;
  } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  if (!emails || emails.length === 0) {
    return NextResponse.json({ error: "No emails provided" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Get existing active suppressions for this workspace
  const { data: existing } = await supabase
    .from("suppressions")
    .select("email")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .in("email", emails);

  const existingEmails = new Set((existing || []).map((s) => s.email));

  const toInsert = emails
    .filter((email) => email && email.includes("@") && !existingEmails.has(email))
    .map((email) => ({
      workspace_id: workspaceId,
      email: email.toLowerCase().trim(),
      reason,
      source,
      created_by: user.id,
    }));

  const skipped = emails.length - toInsert.length;
  let imported = 0;

  if (toInsert.length > 0) {
    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const { error } = await supabase.from("suppressions").insert(batch);
      if (!error) {
        imported += batch.length;
      }
    }
  }

  return NextResponse.json({ imported, skipped });
}
