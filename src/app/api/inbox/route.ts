import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") || "all";
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = page * limit;

  let query = supabase
    .from("inbox_messages")
    .select(
      `
      *,
      contacts (
        id,
        first_name,
        last_name,
        email,
        lead_status
      ),
      email_queue (
        subject,
        to_email,
        sender_account_id
      )
    `
    )
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter === "unread") {
    query = query.eq("is_read", false);
  } else if (filter === "interested") {
    query = query.eq("category", "interested");
  } else if (filter === "not_interested") {
    query = query.eq("category", "not_interested");
  } else if (filter === "out_of_office") {
    query = query.eq("category", "out_of_office");
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
