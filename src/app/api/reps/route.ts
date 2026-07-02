import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listReps } from "@/lib/reps/list";

/** GET /api/reps — the workspace's sales reps, with stable shorthand numbers. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reps = await listReps(supabase);
  return NextResponse.json({ reps });
}
