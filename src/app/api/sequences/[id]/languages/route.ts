import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLanguageVariantsForStep } from "@/lib/sequences/generate-language-variants";
import { normalizeLanguage } from "@/lib/i18n/languages";
import { defaultLanguage, sequenceLanguages } from "@/lib/sequences/language";
import type { SequenceSettings } from "@/lib/database.types";

/**
 * GET /api/sequences/[id]/languages
 *
 * Translation coverage for the whole sequence: which languages it speaks and,
 * per email step, which of them already have copy. Powers the multi-language
 * panel on the sequence page so "is this actually ready to send in Polish?"
 * is answerable without opening every step.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, workspace_id, settings")
    .eq("id", sequenceId)
    .single();

  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", sequence.workspace_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = sequence.settings as SequenceSettings | null;
  const languages = sequenceLanguages(settings);
  const sourceLanguage = defaultLanguage(settings);

  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("id, step_order, type, subject_override, body_override")
    .eq("sequence_id", sequenceId)
    .eq("type", "email")
    .order("step_order", { ascending: true });

  const emailSteps = steps ?? [];
  const stepIds = emailSteps.map((s) => s.id);

  const variantsByStep = new Map<string, { language: string | null }[]>();
  if (stepIds.length > 0) {
    const { data: variants } = await supabase
      .from("sequence_step_variants")
      .select("sequence_step_id, language, is_active")
      .in("sequence_step_id", stepIds);
    for (const v of variants ?? []) {
      const arr = variantsByStep.get(v.sequence_step_id) ?? [];
      if (v.is_active) arr.push({ language: v.language });
      variantsByStep.set(v.sequence_step_id, arr);
    }
  }

  const stepCoverage = emailSteps.map((step) => {
    const present = new Set(
      (variantsByStep.get(step.id) ?? [])
        .map((v) => normalizeLanguage(v.language))
        .filter((l): l is string => !!l),
    );
    // The master language counts as covered when the step has its own copy,
    // even before that copy has been promoted to a variant.
    const hasStepCopy =
      (step.subject_override?.trim() ?? "") !== "" ||
      (step.body_override?.trim() ?? "") !== "";
    if (hasStepCopy) present.add(sourceLanguage);

    return {
      stepId: step.id,
      stepOrder: step.step_order,
      subject: step.subject_override ?? "",
      covered: languages.filter((l) => present.has(l)),
      missing: languages.filter((l) => !present.has(l)),
    };
  });

  return NextResponse.json({
    languages,
    sourceLanguage,
    steps: stepCoverage,
    /** True when every configured language has copy on every email step. */
    complete:
      languages.length > 0 && stepCoverage.every((s) => s.missing.length === 0),
  });
}

/**
 * POST /api/sequences/[id]/languages
 *
 * Translate EVERY email step in the sequence into its configured languages,
 * so a multi-language campaign is one click rather than one click per step.
 *
 * Steps are translated sequentially on purpose: each one is several LLM calls,
 * and firing them all at once would hammer the rate limit on a long sequence.
 *
 * Body: { languages?: string[], overwrite?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { id: sequenceId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    languages?: unknown;
    overwrite?: unknown;
  };

  const { data: sequence } = await supabase
    .from("sequences")
    .select("id, workspace_id, settings")
    .eq("id", sequenceId)
    .single();

  if (!sequence) {
    return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", sequence.workspace_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = sequence.settings as SequenceSettings | null;
  const requested = Array.isArray(body.languages)
    ? body.languages.filter((l): l is string => typeof l === "string")
    : undefined;

  if ((requested ?? sequenceLanguages(settings)).length === 0) {
    return NextResponse.json(
      { error: "No languages set. Tick them in sequence settings first." },
      { status: 400 },
    );
  }

  const { data: steps } = await supabase
    .from("sequence_steps")
    .select("id, step_order, subject_override, body_override")
    .eq("sequence_id", sequenceId)
    .eq("type", "email")
    .order("step_order", { ascending: true });

  const emailSteps = steps ?? [];
  if (emailSteps.length === 0) {
    return NextResponse.json(
      { error: "This sequence has no email steps yet." },
      { status: 400 },
    );
  }

  const results = [];
  for (const step of emailSteps) {
    results.push(
      await generateLanguageVariantsForStep(supabase, {
        step,
        workspaceId: sequence.workspace_id,
        settings,
        languages: requested,
        overwrite: body.overwrite === true,
      }),
    );
  }

  return NextResponse.json({
    steps: results,
    createdTotal: results.reduce((n, r) => n + r.created.length, 0),
    skippedTotal: results.reduce((n, r) => n + r.skipped.length, 0),
    failedTotal: results.reduce((n, r) => n + r.failed.length, 0),
    stepsWithoutCopy: results.filter((r) => r.error).length,
  });
}
