import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  DtcCodeDetail,
  DtcCodeSummary,
  DtcFigure,
  DtcSection,
  DtcVehicle,
} from "@/lib/dtc-lookup/types";

/**
 * GET /api/dtc-lookup
 *   (no params)      → { vehicle, codes }  full code index for instant client-side filtering
 *   ?code=EC55A      → { vehicle, detail } full manual entry + figures for one code
 *   ?q=free+text     → { vehicle, codes }  server-side full-text search across the manual body
 *
 * The data is the LEMON / CHARM per-vehicle service manual, imported by
 * scripts/import-dtc-manual.py. It is global reference data (not workspace
 * scoped), readable by any authenticated user.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: vehicleRow } = await supabase
    .from("dtc_manual_vehicles")
    .select("id, slug, make, model, year, engine, source, page_count, code_count")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!vehicleRow) {
    return NextResponse.json({ vehicle: null, codes: [] as DtcCodeSummary[] });
  }
  const vehicle = vehicleRow as DtcVehicle;

  const code = req.nextUrl.searchParams.get("code")?.trim();
  const q = req.nextUrl.searchParams.get("q")?.trim();

  // ---- single code detail -------------------------------------------------
  if (code) {
    const { data: rows, error } = await supabase
      .from("dtc_manual_codes")
      .select("id, code, chart, part, summary, sections, body, source_url")
      .eq("vehicle_id", vehicle.id)
      .ilike("code", code)
      .order("page_id", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows?.length) return NextResponse.json({ vehicle, detail: null });

    const ids = rows.map((r) => r.id);
    const { data: figRows } = await supabase
      .from("dtc_manual_figures")
      .select("code_id, ord, filename, caption")
      .in("code_id", ids)
      .order("ord", { ascending: true });

    // A code can span several manual pages ("Part 1" / "Part 2"). Merge them
    // into one entry so the reader sees the whole thing, de-duplicating the
    // repeated lead paragraph and any figure that appears on both parts.
    const seenFig = new Set<string>();
    const figures: DtcFigure[] = [];
    for (const f of figRows ?? []) {
      if (!f.filename || seenFig.has(f.filename)) continue;
      seenFig.add(f.filename);
      figures.push({ ord: f.ord, filename: f.filename, caption: f.caption });
    }

    const seenSection = new Set<string>();
    const sections: DtcSection[] = [];
    for (const r of rows) {
      for (const s of (r.sections ?? []) as unknown as DtcSection[]) {
        const key = `${s.heading ?? ""}::${s.text}`;
        if (!s.text && !s.heading) continue;
        if (seenSection.has(key)) continue;
        seenSection.add(key);
        sections.push(s);
      }
    }

    const detail: DtcCodeDetail = {
      id: rows[0].id,
      code: rows[0].code,
      chart: rows[0].chart,
      part: rows.length > 1 ? `${rows.length} parts` : rows[0].part,
      summary: rows[0].summary,
      sections,
      body: rows.map((r) => r.body ?? "").join("\n\n"),
      source_url: rows[0].source_url,
      figures,
    };
    return NextResponse.json({ vehicle, detail });
  }

  // ---- full-text search over the manual body ------------------------------
  if (q) {
    const { data, error } = await supabase
      .from("dtc_manual_codes")
      .select("id, code, chart, part, summary")
      .eq("vehicle_id", vehicle.id)
      .textSearch("body", q, { type: "websearch", config: "english" })
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ vehicle, codes: dedupe((data ?? []) as DtcCodeSummary[]) });
  }

  // ---- full index ---------------------------------------------------------
  const { data, error } = await supabase
    .from("dtc_manual_codes")
    .select("id, code, chart, part, summary")
    .eq("vehicle_id", vehicle.id)
    .order("code", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vehicle, codes: dedupe((data ?? []) as DtcCodeSummary[]) });
}

/** One row per code — the manual splits some codes across Part 1 / Part 2. */
function dedupe(rows: DtcCodeSummary[]): DtcCodeSummary[] {
  const byCode = new Map<string, DtcCodeSummary>();
  for (const r of rows) {
    const prev = byCode.get(r.code);
    if (!prev || (r.summary?.length ?? 0) > (prev.summary?.length ?? 0)) {
      byCode.set(r.code, r);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
