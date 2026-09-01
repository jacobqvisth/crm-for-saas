// Autopilot settings and run log for the /articles Autopilot tab.
//
// GET  /api/articles/autopilot            -> { settings, decision, runs, categories, tags }
// GET  /api/articles/autopilot?runway=1   -> also { runway } (a slow read, opt-in)
// PUT  /api/articles/autopilot            -> { settings }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { articleOptionsSchema } from "@/lib/articles/generation-options";
import { isWebflowConfigured, listCategories, listTags } from "@/lib/articles/webflow";
import { loadDiagnosticCandidates } from "@/lib/articles/sources";
import { decideRun, localParts, settingsFromRow, type AutopilotSettings } from "@/lib/articles/autopilot";

// The runway read runs both the diagnostics loader and a full articles scan.
export const maxDuration = 60;

const HISTORY_LIMIT = 50;

const putSchema = z.object({
  enabled: z.boolean().optional(),
  perDay: z.number().int().min(1).max(12).optional(),
  intervalHours: z.number().int().min(1).max(12).optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  timeZone: z.string().min(1).max(64).optional(),
  weekdaysOnly: z.boolean().optional(),
  publishMode: z.enum(["live", "stage"]).optional(),
  allowedCategories: z.array(z.string().max(120)).max(50).optional(),
  extraTags: z.array(z.string().max(120)).max(50).optional(),
  statsEvery: z.number().int().min(0).max(50).optional(),
  statsCooldownDays: z.number().int().min(0).max(365).optional(),
  options: articleOptionsSchema.optional(),
});

/** Slot list rendered as local wall-clock times, for the UI. */
function slotLabels(settings: AutopilotSettings, slots: number[]): string[] {
  return slots.map((h) => `${String(h).padStart(2, "0")}:00`);
}

export async function GET(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data: row } = await supabase
    .from("article_autopilot_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const settings = settingsFromRow(row);

  const now = new Date();
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const [{ data: recentRuns }, { data: todayRuns }] = await Promise.all([
    supabase
      .from("article_autopilot_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("ran_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from("article_autopilot_runs")
      .select("ran_at, status")
      .eq("workspace_id", workspaceId)
      .gte("ran_at", since)
      .in("status", ["published", "staged"]),
  ]);

  const today = localParts(now, settings.timeZone).dateKey;
  const publishedToday = (todayRuns ?? []).filter(
    (r: { ran_at: string }) => localParts(new Date(r.ran_at), settings.timeZone).dateKey === today,
  ).length;

  const decision = decideRun({ settings, now, publishedToday });

  // The site's real taxonomy, so the settings form offers what exists rather
  // than a hardcoded list that drifts the moment someone adds a category.
  const [categories, tags] = isWebflowConfigured()
    ? await Promise.all([listCategories(), listTags()])
    : [[], []];

  let runway: { usable: number; note: string } | null = null;
  if (request.nextUrl.searchParams.get("runway") === "1") {
    runway = await computeRunway(supabase, workspaceId);
  }

  return NextResponse.json({
    settings,
    configured: isWebflowConfigured(),
    lastCheckedAt: (row as { last_checked_at?: string } | null)?.last_checked_at ?? null,
    publishedToday,
    decision: { ...decision, slotLabels: slotLabels(settings, decision.slots) },
    runs: recentRuns ?? [],
    categories,
    tags,
    runway,
  });
}

export async function PUT(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId, userId } = ws;

  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }
  const p = parsed.data;

  // Column names, not the camelCase the UI speaks.
  const update: Record<string, unknown> = { updated_by: userId };
  if (p.enabled !== undefined) update.enabled = p.enabled;
  if (p.perDay !== undefined) update.per_day = p.perDay;
  if (p.intervalHours !== undefined) update.interval_hours = p.intervalHours;
  if (p.startHour !== undefined) update.start_hour = p.startHour;
  if (p.timeZone !== undefined) update.time_zone = p.timeZone;
  if (p.weekdaysOnly !== undefined) update.weekdays_only = p.weekdaysOnly;
  if (p.publishMode !== undefined) update.publish_mode = p.publishMode;
  if (p.allowedCategories !== undefined) update.allowed_categories = p.allowedCategories;
  if (p.extraTags !== undefined) update.extra_tags = p.extraTags;
  if (p.statsEvery !== undefined) update.stats_every = p.statsEvery;
  if (p.statsCooldownDays !== undefined) update.stats_cooldown_days = p.statsCooldownDays;
  if (p.options !== undefined) update.options = p.options;

  // Upsert rather than update: the migration seeds the shared workspace, but a
  // deployment restored from an older dump would have no row and the settings
  // form would silently save nothing.
  const { data, error } = await supabase
    .from("article_autopilot_settings")
    .upsert({ workspace_id: workspaceId, ...update }, { onConflict: "workspace_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settings = settingsFromRow(data);
  const decision = decideRun({ settings, now: new Date(), publishedToday: 0 });
  return NextResponse.json({
    settings,
    decision: { ...decision, slotLabels: slotLabels(settings, decision.slots) },
  });
}

/**
 * How many more articles the diagnostics well can support.
 *
 * Worth surfacing because the honest answer to "can this run forever" is no: it
 * runs until the unused rich diagnostics are gone, and then it stops rather than
 * lowering its standards. Seeing that number fall is the early warning.
 */
async function computeRunway(
  supabase: any,
  workspaceId: string,
): Promise<{ usable: number; note: string }> {
  const [candidates, { data: articles }] = await Promise.all([
    loadDiagnosticCandidates(2000),
    supabase
      .from("articles")
      .select("source_ref")
      .eq("workspace_id", workspaceId)
      .not("source_ref", "is", null),
  ]);

  const used = new Set(
    ((articles ?? []) as { source_ref: string | null }[]).map((a) => a.source_ref).filter(Boolean),
  );
  const usable = candidates.filter(
    (c) => !used.has(c.diagnosticId) && Boolean(c.description) && c.causeCount >= 2 && c.dtcs.length > 0,
  ).length;

  return {
    usable,
    note: "Unused diagnostics with a described problem, two or more ranked causes and a fault code.",
  };
}
