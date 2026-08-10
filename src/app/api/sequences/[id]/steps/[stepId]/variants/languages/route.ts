import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { translateOutboundEmail } from "@/lib/inbox/translate-outbound";
import { languageLabel, normalizeLanguage } from "@/lib/i18n/languages";
import { defaultLanguage, sequenceLanguages } from "@/lib/sequences/language";
import type { SequenceSettings } from "@/lib/database.types";

/**
 * POST /api/sequences/[id]/steps/[stepId]/variants/languages
 *
 * Fill in the missing language versions of a step, by translating its master
 * copy once per language and storing each as a language-tagged variant.
 *
 * Translations are generated at AUTHORING time, never at send time, so every
 * one is editable and reviewable before it reaches a customer. They land
 * flagged `ai_generated` and are ordinary variants from that point on.
 *
 * Body: { languages?: string[], overwrite?: boolean }
 *   languages — defaults to the sequence's configured language set
 *   overwrite — replace existing AI-generated translations (hand-edited
 *               variants are never overwritten)
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
  const overwrite = body.overwrite === true;

  const { data: step } = await supabase
    .from("sequence_steps")
    .select(
      "id, sequence_id, subject_override, body_override, sequences!inner(workspace_id, settings)",
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
  const workspaceId = sequence.workspace_id;

  // Workspace gate — the step lookup alone doesn't prove membership.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = sequence.settings;
  const sourceLanguage = defaultLanguage(settings);

  const requested = Array.isArray(body.languages)
    ? body.languages.filter((l): l is string => typeof l === "string")
    : sequenceLanguages(settings);

  const targets = [
    ...new Set(
      requested
        .map((l) => normalizeLanguage(l))
        .filter((l): l is string => !!l && l !== sourceLanguage),
    ),
  ];

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          "No target languages. Add languages to the sequence settings first.",
      },
      { status: 400 },
    );
  }

  const { data: existingRows } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId)
    .order("created_at", { ascending: true });
  const existing = existingRows ?? [];

  // The master copy: whichever variant carries the source language, else an
  // untagged variant, else the step's own override.
  const masterVariant =
    existing.find((v) => normalizeLanguage(v.language) === sourceLanguage) ??
    existing.find((v) => normalizeLanguage(v.language) === null) ??
    null;

  const masterSubject = masterVariant?.subject ?? step.subject_override ?? "";
  const masterBody = masterVariant?.body_html ?? step.body_override ?? "";

  if (!masterSubject.trim() && !masterBody.trim()) {
    return NextResponse.json(
      { error: "This step has no copy to translate yet." },
      { status: 400 },
    );
  }

  // Promote the master to a proper language-tagged variant. Without this the
  // source language would have no variant of its own, and readers in it would
  // fall through to the step body while everyone else got a variant, which
  // splits analytics across two different mechanisms.
  if (masterVariant && normalizeLanguage(masterVariant.language) === null) {
    await supabase
      .from("sequence_step_variants")
      .update({ language: sourceLanguage })
      .eq("id", masterVariant.id);
  } else if (!masterVariant) {
    await supabase.from("sequence_step_variants").insert({
      sequence_step_id: stepId,
      workspace_id: workspaceId,
      name: languageLabel(sourceLanguage),
      subject: masterSubject,
      body_html: masterBody,
      language: sourceLanguage,
      weight: 1,
      is_active: true,
    });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const failed: { language: string; reason: string }[] = [];

  for (const language of targets) {
    const already = existing.find(
      (v) => normalizeLanguage(v.language) === language,
    );
    if (already && !(overwrite && already.ai_generated)) {
      skipped.push(language);
      continue;
    }

    const result = await translateOutboundEmail({
      subject: masterSubject,
      bodyHtml: masterBody,
      targetLanguage: language,
      sourceLanguage,
    });

    if (!result.ok) {
      failed.push({ language, reason: result.reason });
      continue;
    }

    if (already) {
      const { error } = await supabase
        .from("sequence_step_variants")
        .update({
          subject: result.subject,
          body_html: result.bodyHtml,
          ai_generated: true,
          ai_generation_model: result.model,
        })
        .eq("id", already.id);
      if (error) {
        failed.push({ language, reason: error.message });
        continue;
      }
    } else {
      const { error } = await supabase.from("sequence_step_variants").insert({
        sequence_step_id: stepId,
        workspace_id: workspaceId,
        name: languageLabel(language),
        subject: result.subject,
        body_html: result.bodyHtml,
        language,
        weight: 1,
        is_active: true,
        ai_generated: true,
        ai_generation_model: result.model,
      });
      if (error) {
        failed.push({ language, reason: error.message });
        continue;
      }
    }
    created.push(language);
  }

  const { data: variants } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    variants: variants ?? [],
    sourceLanguage,
    created,
    skipped,
    failed,
  });
}
