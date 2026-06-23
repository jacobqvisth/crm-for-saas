import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processCallSession } from "@/lib/calls/process";

// Manual (re)processing trigger for a call session — used to retry a failed
// transcription/analysis from the UI. Authorized as a workspace member; the
// actual processing runs with the service client (bypasses RLS to write
// activities/feedback the same way the webhook does).
export const maxDuration = 300;

const Body = z.object({ sessionId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Authorize: the session must belong to a workspace the user is in (RLS read).
  const { data: session } = await supabase
    .from("call_sessions")
    .select("id")
    .eq("id", parsed.data.sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await processCallSession(createServiceClient(), parsed.data.sessionId);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
