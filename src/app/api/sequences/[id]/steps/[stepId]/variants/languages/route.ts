import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLanguageVariantsForStep } from "@/lib/sequences/generate-language-variants";
import type { SequenceSettings } from "@/lib/database.types";

/**
 * POST /api/sequences/[id]/steps/[stepId]/variants/languages
 *
 * Translate ONE step into the sequence's configured languages.
 * See /api/sequences/[id]/languages for the whole-sequence version.
 *
 * Body: { languages?: string[], overwrite?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const supabase = await createClient();
  const { id: sequenceId, stepId } = await params;

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

  const { data: step } = await supabase
    .from("sequence_steps")
    .select(
      "id, step_order, subject_override, body_override, sequences!inner(workspace_id, settings)",
    )
    .eq("id", stepId)
    .eq("sequence_id", sequenceId)
    .single();

  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const sequence = step.sequences as unknown as {
    workspace_id: string;
    settings: SequenceSettings | null;
  };

  // Workspace gate — the step lookup alone doesn't prove membership.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", sequence.workspace_id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await generateLanguageVariantsForStep(supabase, {
    step,
    workspaceId: sequence.workspace_id,
    settings: sequence.settings,
    languages: Array.isArray(body.languages)
      ? body.languages.filter((l): l is string => typeof l === "string")
      : undefined,
    overwrite: body.overwrite === true,
  });

  if (result.error) {
    return NextResponse.json(
      {
        error:
          result.error === "No target languages configured"
            ? "No target languages. Add languages to the sequence settings first."
            : "This step has no copy to translate yet.",
      },
      { status: 400 },
    );
  }

  const { data: variants } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    variants: variants ?? [],
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
    warnings: result.warnings,
  });
}
