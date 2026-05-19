import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, display_name, status")
    .eq("workspace_id", membership.workspace_id)
    .order("email_address", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
