import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ count: 0 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ count: 0 });

  const now = new Date().toISOString();

  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", membership.workspace_id)
    .is("completed_at", null)
    .lte("due_date", now)
    .or(`snoozed_until.is.null,snoozed_until.lt.${now}`);

  return NextResponse.json({ count: count ?? 0 });
}
