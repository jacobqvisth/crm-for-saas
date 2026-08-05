import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Registry of alias addresses (e.g. support@wrenchlane.com) that live on the
// workspace's connected mailboxes. Powers the Inbox "lane" filter and the
// send-as From selector in the reply composer.
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
    .from("mailbox_aliases")
    .select("id, email_address, display_name, gmail_account_id, can_send_as")
    .eq("workspace_id", membership.workspace_id)
    .order("email_address", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
