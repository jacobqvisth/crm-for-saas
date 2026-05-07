import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VISIT_OUTCOMES, type VisitOutcome, logVisit } from "@/lib/routes/visits";

const VisitBody = z.object({
  outcome: z.enum(VISIT_OUTCOMES as readonly [VisitOutcome, ...VisitOutcome[]]),
  notes: z.string().max(500).optional(),
  followUpRequiredOverride: z.boolean().optional(),
  enrollOverride: z.boolean().optional(),
  visitedAt: z.string().datetime().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string; stopId: string }> },
) {
  const { routeId, stopId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: stop, error: stopErr } = await supabase
    .from("route_stops")
    .select("id, route_id, workspace_id")
    .eq("id", stopId)
    .eq("route_id", routeId)
    .maybeSingle();
  if (stopErr) return NextResponse.json({ error: stopErr.message }, { status: 500 });
  if (!stop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", stop.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = VisitBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }

  try {
    const result = await logVisit({
      routeStopId: stopId,
      outcome: parsed.data.outcome,
      notes: parsed.data.notes,
      followUpRequiredOverride: parsed.data.followUpRequiredOverride,
      enrollOverride: parsed.data.enrollOverride,
      visitedAt: parsed.data.visitedAt,
      userId: user.id,
      supabase,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "logVisit failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
