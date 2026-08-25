/**
 * Fill in the missing language versions of a step by translating its master
 * copy once per language and storing each as a language-tagged variant.
 *
 * Translations are generated at AUTHORING time, never at send time, so every
 * one is editable and reviewable before it reaches a customer. They land
 * flagged `ai_generated` and are ordinary variants from that point on.
 *
 * Shared by the per-step route and the whole-sequence route so both behave
 * identically.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SequenceSettings } from "@/lib/database.types";
import { translateOutboundEmail } from "@/lib/inbox/translate-outbound";
import { languageLabel, normalizeLanguage } from "@/lib/i18n/languages";
import { defaultLanguage, sequenceLanguages } from "./language";

export type StepLanguageResult = {
  stepId: string;
  stepOrder: number | null;
  created: string[];
  skipped: string[];
  failed: { language: string; reason: string }[];
  /**
   * Translations that landed but need a human eye, most often a subject line
   * that came back in the source language. Written, not discarded: the body
   * is still good, and an operator can fix the one line.
   */
  warnings: string[];
  /** Set when the step could not be processed at all (e.g. no copy yet). */
  error?: string;
};

type StepRow = {
  id: string;
  step_order: number | null;
  subject_override: string | null;
  body_override: string | null;
};

/**
 * Translate one step into every target language it's missing.
 *
 * Returns per-language outcomes rather than throwing, so a whole-sequence run
 * can report "step 3 had no copy yet" without losing the steps that worked.
 */
export async function generateLanguageVariantsForStep(
  supabase: SupabaseClient<Database>,
  opts: {
    step: StepRow;
    workspaceId: string;
    settings: SequenceSettings | null;
    /** Defaults to the sequence's configured language set. */
    languages?: string[];
    /** Replace existing AI-generated translations. Hand-edited ones are never touched. */
    overwrite?: boolean;
  },
): Promise<StepLanguageResult> {
  const { step, workspaceId, settings, overwrite = false } = opts;
  const base: StepLanguageResult = {
    stepId: step.id,
    stepOrder: step.step_order,
    created: [],
    skipped: [],
    failed: [],
    warnings: [],
  };

  const sourceLanguage = defaultLanguage(settings);
  const requested = opts.languages ?? sequenceLanguages(settings);
  const targets = [
    ...new Set(
      requested
        .map((l) => normalizeLanguage(l))
        .filter((l): l is string => !!l && l !== sourceLanguage),
    ),
  ];

  if (targets.length === 0) {
    return { ...base, error: "No target languages configured" };
  }

  const { data: existingRows } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", step.id)
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
    return { ...base, error: "No copy to translate yet" };
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
      sequence_step_id: step.id,
      workspace_id: workspaceId,
      name: languageLabel(sourceLanguage),
      subject: masterSubject,
      body_html: masterBody,
      language: sourceLanguage,
      weight: 1,
      is_active: true,
    });
  }

  for (const language of targets) {
    const already = existing.find(
      (v) => normalizeLanguage(v.language) === language,
    );
    if (already && !(overwrite && already.ai_generated)) {
      base.skipped.push(language);
      continue;
    }

    const result = await translateOutboundEmail({
      subject: masterSubject,
      bodyHtml: masterBody,
      targetLanguage: language,
      sourceLanguage,
    });

    if (!result.ok) {
      base.failed.push({ language, reason: result.reason });
      continue;
    }

    if (result.subjectUntranslated) {
      base.warnings.push(
        `${languageLabel(language)}: subject line came back in ${languageLabel(sourceLanguage)}. Check it before sending.`,
      );
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
        base.failed.push({ language, reason: error.message });
        continue;
      }
    } else {
      const { error } = await supabase.from("sequence_step_variants").insert({
        sequence_step_id: step.id,
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
        base.failed.push({ language, reason: error.message });
        continue;
      }
    }
    base.created.push(language);
  }

  return base;
}
