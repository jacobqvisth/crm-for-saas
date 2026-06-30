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
  const hideOOO = searchParams.get("hideOOO") === "1";
  const sendersParam = searchParams.get("senders");
  const senders = sendersParam
    ? sendersParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
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
    );

  // "Recently answered" sorts by when we replied; every other tab by arrival.
  if (filter === "answered") {
    query = query.order("replied_at", { ascending: false });
  } else {
    query = query.order("received_at", { ascending: false });
  }
  query = query.range(offset, offset + limit - 1);

  if (filter === "unread") {
    query = query.eq("is_read", false);
  } else if (filter === "interested") {
    query = query.eq("category", "interested");
  } else if (filter === "not_interested") {
    query = query.eq("category", "not_interested");
  } else if (filter === "out_of_office") {
    query = query.eq("category", "out_of_office");
  } else if (filter === "needs_reply") {
    // Actionable inbound: not answered, no draft started, not an auto-reply,
    // not already triaged as not-interested/OOO. (is_auto_reply may be NULL on
    // older rows, so include NULL explicitly.)
    query = query
      .is("replied_at", null)
      .is("reply_draft", null)
      .or("is_auto_reply.is.null,is_auto_reply.is.false")
      .not("category", "in", "(not_interested,out_of_office)");
  } else if (filter === "started_replying") {
    // A draft is in progress but nothing has been sent yet.
    query = query.is("replied_at", null).not("reply_draft", "is", null);
  } else if (filter === "answered") {
    query = query.not("replied_at", "is", null);
  }

  // Hide OOO from any non-OOO tab when toggle is on.
  if (hideOOO && filter !== "out_of_office") {
    query = query.neq("category", "out_of_office");
  }

  if (senders) {
    if (senders.length === 0) {
      // Explicit empty selection — caller asked to see nothing.
      return NextResponse.json([]);
    }
    query = query.in("gmail_account_id", senders);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
