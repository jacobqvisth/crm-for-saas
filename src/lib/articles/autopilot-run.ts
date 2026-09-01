// One turn of the Autopilot: decide, write, publish, log.
//
// Split from autopilot.ts so the scheduling and topic logic there stays pure and
// unit-testable, while everything with a side effect lives here.
//
// The whole function is written to be safe to call more often than the schedule
// needs. The cron fires hourly, a human can press "Run one now" at any moment,
// and both land here; the slot arithmetic in decideRun() is what keeps the day's
// count correct regardless.

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateArticle } from "./generate";
import { publishArticleRow } from "./publish";
import { isWebflowConfigured } from "./webflow";
import { EMPTY_IMPACT } from "./types";
import {
  decideRun,
  localParts,
  pickTopic,
  settingsFromRow,
  type AutopilotSettings,
  type RunDecision,
} from "./autopilot";

type DB = SupabaseClient<any, any, any>;

export interface AutopilotRunResult {
  status: "published" | "staged" | "skipped" | "failed";
  reason: string;
  decision: RunDecision;
  settings: AutopilotSettings;
  articleId?: string;
  url?: string;
  /** Nullable: the model is allowed to return a draft with no headline yet. */
  title?: string | null;
  label?: string;
  sourceKind?: string;
  model?: string;
  durationMs: number;
}

export interface RunAutopilotInput {
  supabase: DB;
  workspaceId: string;
  trigger: "cron" | "manual";
  /**
   * Manual runs from the Autopilot tab bypass the clock but not the safety
   * rails: Webflow still has to be configured and a topic still has to exist.
   * This is the "Run one now" button, used to prove the pipeline before the
   * schedule is switched on.
   */
  ignoreSchedule?: boolean;
  now?: Date;
}

export async function runAutopilotOnce(input: RunAutopilotInput): Promise<AutopilotRunResult> {
  const { supabase, workspaceId, trigger } = input;
  const now = input.now ?? new Date();
  const startedAt = Date.now();

  const { data: settingsRow } = await supabase
    .from("article_autopilot_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const settings = settingsFromRow(settingsRow);

  // Liveness stamp. Written before any early return so a skipped invocation still
  // proves the cron reached this code.
  await supabase
    .from("article_autopilot_settings")
    .update({ last_checked_at: now.toISOString() })
    .eq("workspace_id", workspaceId);

  const publishedToday = await countPublishedToday(supabase, workspaceId, settings, now);
  const decision = decideRun({ settings, now, publishedToday });

  const done = (r: Omit<AutopilotRunResult, "decision" | "settings" | "durationMs">) => ({
    ...r,
    decision,
    settings,
    durationMs: Date.now() - startedAt,
  });

  if (!decision.run && !input.ignoreSchedule) {
    // Routine skips are deliberately not logged. At hourly cadence they would be
    // twenty rows a day of "next slot at 14:00", which buries the entries that
    // matter. last_checked_at above already answers "is it running".
    return done({ status: "skipped", reason: decision.reason });
  }

  if (!isWebflowConfigured()) {
    const reason = "Webflow is not configured (WEBFLOW_API_TOKEN / WEBFLOW_SITE_ID)";
    await logRun(supabase, workspaceId, { status: "failed", reason, trigger, durationMs: Date.now() - startedAt });
    return done({ status: "failed", reason });
  }

  // What has been written about already, across the whole Library rather than
  // just autopilot's own output: a diagnostic Jacob wrote up by hand in the
  // Studio must not come round again here.
  const { usedRefs, statLastUsed, totalWritten } = await loadHistory(supabase, workspaceId);

  const picked = await pickTopic({ usedRefs, statLastUsed, totalWritten, settings, now });
  if (!picked.topic) {
    await logRun(supabase, workspaceId, {
      status: "skipped",
      reason: picked.reason,
      trigger,
      durationMs: Date.now() - startedAt,
    });
    return done({ status: "skipped", reason: picked.reason });
  }
  const topic = picked.topic;

  const generated = await generateArticle({
    format: "blog_article",
    options: topic.options,
    impact: EMPTY_IMPACT,
    diagnostic: topic.diagnostic,
    statPack: topic.statPack,
    freeTopic: undefined,
  });

  if (!generated.ok) {
    const reason = `Generation failed (${generated.kind}): ${generated.reason}`;
    await logRun(supabase, workspaceId, {
      status: "failed",
      reason,
      trigger,
      sourceKind: topic.sourceKind,
      sourceRef: topic.sourceRef,
      durationMs: Date.now() - startedAt,
    });
    return done({ status: "failed", reason, label: topic.label, sourceKind: topic.sourceKind });
  }
  const a = generated.article;

  const { data: articleRow, error: insertError } = await supabase
    .from("articles")
    .insert({
      workspace_id: workspaceId,
      source_kind: topic.sourceKind,
      source_ref: topic.sourceRef,
      source_snapshot: topic.snapshot,
      format: "blog_article",
      options: topic.options,
      language: "en",
      title: a.title,
      body: a.body,
      hooks: a.hooks,
      hashtags: a.hashtags,
      seo: a.seo,
      claims: a.claims,
      impact: EMPTY_IMPACT,
      status: "draft",
      model: a.model,
      created_by: null,
    })
    .select()
    .single();

  if (insertError || !articleRow) {
    const reason = `Wrote the article but could not save it: ${insertError?.message ?? "no row"}`;
    await logRun(supabase, workspaceId, {
      status: "failed",
      reason,
      trigger,
      sourceKind: topic.sourceKind,
      sourceRef: topic.sourceRef,
      model: a.model,
      durationMs: Date.now() - startedAt,
    });
    return done({ status: "failed", reason, label: topic.label, sourceKind: topic.sourceKind });
  }

  const published = await publishArticleRow({
    supabase,
    workspaceId,
    row: articleRow,
    mode: settings.publishMode,
    allowedCategories: settings.allowedCategories,
    extraTagNames: settings.extraTags,
  });

  if (!published.ok) {
    // The draft is saved and visible in the Library either way, so this is
    // recoverable by hand rather than lost work. Say so in the reason.
    const reason = `${published.error} (the draft is in the Library)`;
    await logRun(supabase, workspaceId, {
      status: "failed",
      reason,
      trigger,
      articleId: articleRow.id,
      sourceKind: topic.sourceKind,
      sourceRef: topic.sourceRef,
      model: a.model,
      durationMs: Date.now() - startedAt,
    });
    return done({
      status: "failed",
      reason,
      articleId: articleRow.id,
      title: a.title,
      label: topic.label,
      sourceKind: topic.sourceKind,
      model: a.model,
    });
  }

  const status = published.live ? "published" : "staged";
  const reason = published.live
    ? `Live: ${topic.label}`
    : `Staged in Webflow, not yet public: ${topic.label}`;

  await logRun(supabase, workspaceId, {
    status,
    reason,
    trigger,
    articleId: articleRow.id,
    sourceKind: topic.sourceKind,
    sourceRef: topic.sourceRef,
    url: published.url,
    model: a.model,
    durationMs: Date.now() - startedAt,
  });

  return done({
    status,
    reason,
    articleId: articleRow.id,
    url: published.url,
    title: a.title,
    label: topic.label,
    sourceKind: topic.sourceKind,
    model: a.model,
  });
}

/* ------------------------------------------------------------- helpers */

/**
 * How many went out today, in the configured zone.
 *
 * Counted off the run log rather than off `articles.published_at`, because the
 * Studio and the Releases tab also write published articles and those must not
 * consume autopilot's daily quota. Reading 48 hours and filtering by local date
 * avoids having to compute the UTC instant of local midnight, which is the step
 * that goes wrong twice a year.
 */
async function countPublishedToday(
  supabase: DB,
  workspaceId: string,
  settings: AutopilotSettings,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("article_autopilot_runs")
    .select("ran_at, status")
    .eq("workspace_id", workspaceId)
    .gte("ran_at", since)
    .in("status", ["published", "staged"]);

  const today = localParts(now, settings.timeZone).dateKey;
  return (data ?? []).filter(
    (r: { ran_at: string }) => localParts(new Date(r.ran_at), settings.timeZone).dateKey === today,
  ).length;
}

async function loadHistory(supabase: DB, workspaceId: string) {
  const { data: articles } = await supabase
    .from("articles")
    .select("source_kind, source_ref, created_at")
    .eq("workspace_id", workspaceId)
    .not("source_ref", "is", null);

  const usedRefs = new Set<string>();
  const statLastUsed = new Map<string, Date>();
  for (const row of (articles ?? []) as {
    source_kind: string | null;
    source_ref: string | null;
    created_at: string | null;
  }[]) {
    if (!row.source_ref) continue;
    usedRefs.add(row.source_ref);
    if (row.source_kind === "stats" && row.created_at) {
      const at = new Date(row.created_at);
      const prev = statLastUsed.get(row.source_ref);
      if (!prev || at > prev) statLastUsed.set(row.source_ref, at);
    }
  }

  const { count } = await supabase
    .from("article_autopilot_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", ["published", "staged"]);

  return { usedRefs, statLastUsed, totalWritten: count ?? 0 };
}

async function logRun(
  supabase: DB,
  workspaceId: string,
  row: {
    status: string;
    reason: string;
    trigger: "cron" | "manual";
    articleId?: string;
    sourceKind?: string;
    sourceRef?: string;
    url?: string;
    model?: string;
    durationMs: number;
  },
) {
  // Deliberately checked: an insert that silently fails here would leave the
  // scheduler unable to count what it has already published, which is the one
  // failure that would make it publish more than it should.
  const { error } = await supabase.from("article_autopilot_runs").insert({
    workspace_id: workspaceId,
    status: row.status,
    reason: row.reason.slice(0, 1000),
    trigger: row.trigger,
    article_id: row.articleId ?? null,
    source_kind: row.sourceKind ?? null,
    source_ref: row.sourceRef ?? null,
    url: row.url ?? null,
    model: row.model ?? null,
    duration_ms: row.durationMs,
  });
  if (error) console.error("[autopilot] could not write the run log:", error.message);
}
