import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compareDiagnoses } from "@/lib/dtc-lookup/compare";

export const maxDuration = 60;

/**
 * GET  /api/dtc-lookup/compare?code=EC55A
 *   → { wrenchlane, comparison }  whatever already exists for this code
 * POST /api/dtc-lookup/compare  { code }
 *   → generates the comparison (or returns the cached one) and stores it
 *
 * The factory manual is the reference. Wrenchlane results are captured by
 * scripts/wrenchlane-capture.mjs until the Wrenchlane API is available.
 */
async function load(code: string) {
  const supabase = await createClient();
  const { data: veh } = await supabase
    .from("dtc_manual_vehicles")
    .select("id, make, model, year, engine")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!veh) return null;

  const { data: wl } = await supabase
    .from("dtc_wrenchlane_results")
    .select("id, code, summary, causes, raw, app_engine_code, captured_at")
    .eq("vehicle_id", veh.id)
    .ilike("code", code)
    .maybeSingle();

  const { data: cmp } = await supabase
    .from("dtc_comparisons")
    .select("id, code, agreement, score, verdict, model, created_at")
    .eq("vehicle_id", veh.id)
    .ilike("code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { supabase, veh, wl, cmp };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const ctx = await load(code);
  if (!ctx) return NextResponse.json({ wrenchlane: null, comparison: null });
  return NextResponse.json({ wrenchlane: ctx.wl ?? null, comparison: ctx.cmp ?? null });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code: string | undefined = body?.code?.trim();
  const force: boolean = body?.force === true;
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const ctx = await load(code);
  if (!ctx) return NextResponse.json({ error: "no vehicle" }, { status: 404 });
  const { veh, wl, cmp } = ctx;

  if (cmp && !force) return NextResponse.json({ wrenchlane: wl ?? null, comparison: cmp });

  if (!wl) {
    // Nothing captured for this code yet. Record that plainly rather than
    // inventing a comparison out of one source.
    const { data: stored } = await supabase
      .from("dtc_comparisons")
      .insert({
        vehicle_id: veh.id,
        code,
        agreement: "no_wrenchlane_data",
        score: null,
        verdict: {
          headline:
            "No Wrenchlane diagnosis has been captured for this code yet. Run the capture script for it, then compare.",
        },
        model: null,
      })
      .select("id, code, agreement, score, verdict, model, created_at")
      .single();
    return NextResponse.json({ wrenchlane: null, comparison: stored });
  }

  const { data: manual } = await supabase
    .from("dtc_manual_codes")
    .select("id, body, summary")
    .eq("vehicle_id", veh.id)
    .ilike("code", code)
    .order("page_id", { ascending: true });

  const lemonText = (manual ?? []).map((m) => m.body ?? "").join("\n\n").trim();
  if (!lemonText) return NextResponse.json({ error: "no manual entry for " + code }, { status: 404 });

  const wlRaw = (wl.raw ?? {}) as Record<string, unknown>;
  const verdict = await compareDiagnoses({
    code,
    vehicle: `${veh.year} ${veh.make} ${veh.model} ${veh.engine ?? ""}`.trim(),
    lemonText,
    wrenchlaneText: typeof wlRaw.text === "string" ? wlRaw.text : (wl.summary ?? ""),
    wrenchlaneCauses: Array.isArray(wl.causes)
      ? (wl.causes as Array<{ name?: string; confidence?: number }>)
      : [],
  });

  const { data: stored, error } = await supabase
    .from("dtc_comparisons")
    .insert({
      vehicle_id: veh.id,
      code,
      lemon_code_id: manual?.[0]?.id ?? null,
      wrenchlane_result_id: wl.id,
      agreement: verdict.agreement,
      score: verdict.score,
      verdict: {
        headline: verdict.headline,
        shared: verdict.shared,
        only_lemon: verdict.only_lemon,
        only_wrenchlane: verdict.only_wrenchlane,
        risk_notes: verdict.risk_notes,
      },
      // The model that actually served it, which may be the Gemini fallback.
      model: verdict.model,
    })
    .select("id, code, agreement, score, verdict, model, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ wrenchlane: wl, comparison: stored });
}
