import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/dtc-lookup/history        → the caller's recent lookups
 * POST /api/dtc-lookup/history {query, code, kind, result_count}
 *                                     → record one lookup
 * DELETE /api/dtc-lookup/history      → clear the caller's history
 *
 * History is per user: RLS scopes every row to auth.uid().
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("dtc_search_history")
    .select("id, query, code, kind, result_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Collapse repeats of the same query so the panel stays readable.
  const seen = new Set<string>();
  const items = (data ?? []).filter((r) => {
    const key = `${r.kind}:${(r.code ?? r.query ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const query: string = (body?.query ?? "").toString().trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

  const { data: veh } = await supabase
    .from("dtc_manual_vehicles")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("dtc_search_history")
    .insert({
      user_id: user.id,
      vehicle_id: veh?.id ?? null,
      query: query.slice(0, 200),
      code: body?.code ? String(body.code).slice(0, 40) : null,
      kind: ["lemon", "fulltext", "wrenchlane", "compare"].includes(body?.kind)
        ? body.kind
        : "lemon",
      result_count: Number.isFinite(body?.result_count) ? body.result_count : null,
    })
    .select("id, query, code, kind, result_count, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("dtc_search_history").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
