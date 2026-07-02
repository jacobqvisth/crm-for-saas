import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Poll a call session's status + AI analysis. The dialer UI calls this on an
// interval after placing a call to show progress (dialing → completed →
// processing → processed) and then render the AI review card.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // RLS scopes this to the caller's workspace.
  const { data: session, error } = await supabase
    .from("call_sessions")
    .select(
      "id, status, direction, to_number, from_number, duration_seconds, recording_url, transcript, summary, ai_json, ai_processed_at, activity_id, contact_id, company_id, error, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ session });
}
