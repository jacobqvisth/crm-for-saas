import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveArticlesWorkspace } from "@/lib/articles/server";
import { articleOptionsSchema, normalizeArticleOptions } from "@/lib/articles/generation-options";
import { getFormatSpec } from "@/lib/articles/formats";
import { generateArticle } from "@/lib/articles/generate";
import { loadDiagnosticSnapshot, loadStatSources } from "@/lib/articles/sources";
import { buildStatFactPack, getStatStory, type StatStoryKey } from "@/lib/articles/stat-stories";
import { EMPTY_IMPACT, type ArticleImpact } from "@/lib/articles/types";
import type { Json } from "@/lib/database.types";

// Generation calls Opus 5 with adaptive thinking and can legitimately take a
// while on a long blog article, and the stats path also runs both analysers over
// the full diagnostics history first.
export const maxDuration = 120;

const impactSchema = z
  .object({
    hoursSaved: z.number().nullable(),
    daysAvoided: z.number().nullable(),
    ticketValue: z.number().nullable(),
    additionalProfit: z.number().nullable(),
    currency: z.string().nullable(),
    resolvedWithoutEscalation: z.boolean().nullable(),
    note: z.string().nullable(),
  })
  .partial();

const bodySchema = z.object({
  format: z.enum(["linkedin_post", "blog_article", "x_thread", "facebook_post", "newsletter"]),
  sourceKind: z.enum(["diagnostic", "stats", "free_topic"]),
  /** diagnosticId when sourceKind=diagnostic, stat story key when stats. */
  sourceRef: z.string().optional(),
  freeTopic: z.string().max(2000).optional(),
  options: articleOptionsSchema.optional(),
  impact: impactSchema.optional(),
});

// POST /api/articles/generate -> { article: <row> }
export async function POST(request: NextRequest) {
  const ws = await resolveArticlesWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId, userId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { format, sourceKind, sourceRef, freeTopic } = parsed.data;

  if (!getFormatSpec(format)) {
    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  }

  const options = normalizeArticleOptions(parsed.data.options);
  const impact: ArticleImpact = { ...EMPTY_IMPACT, ...(parsed.data.impact ?? {}) };

  // Resolve the grounding. Each branch also produces the snapshot that gets
  // frozen onto the row, so a draft stays readable after the underlying
  // diagnostics rotate out of the S3 export.
  let diagnostic = null;
  let statPack = null;
  let snapshot: unknown = {};

  if (sourceKind === "diagnostic") {
    if (!sourceRef) {
      return NextResponse.json({ error: "sourceRef required for a diagnostic" }, { status: 400 });
    }
    diagnostic = await loadDiagnosticSnapshot(sourceRef);
    if (!diagnostic) {
      return NextResponse.json({ error: "Diagnostic not found" }, { status: 404 });
    }
    snapshot = diagnostic;
  } else if (sourceKind === "stats") {
    if (!sourceRef || !getStatStory(sourceRef)) {
      return NextResponse.json({ error: "Unknown stat story" }, { status: 400 });
    }
    const sources = await loadStatSources();
    statPack = buildStatFactPack(sourceRef as StatStoryKey, sources);
    if (!statPack) {
      return NextResponse.json(
        { error: "Not enough data for that stat story yet" },
        { status: 422 },
      );
    }
    snapshot = statPack;
  } else {
    if (!freeTopic?.trim()) {
      return NextResponse.json({ error: "A topic is required" }, { status: 400 });
    }
    snapshot = { freeTopic: freeTopic.trim() };
  }

  const result = await generateArticle({ format, options, impact, diagnostic, statPack, freeTopic });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }
  const a = result.article;

  const { data, error } = await supabase
    .from("articles")
    .insert({
      workspace_id: workspaceId,
      source_kind: sourceKind,
      source_ref: sourceRef ?? null,
      source_snapshot: snapshot as Json,
      format,
      options: options as unknown as Json,
      language: options.language,
      title: a.title,
      body: a.body,
      hooks: a.hooks as unknown as Json,
      hashtags: a.hashtags,
      seo: a.seo as unknown as Json,
      claims: a.claims as unknown as Json,
      impact: impact as unknown as Json,
      status: "draft",
      model: a.model,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ article: data });
}
