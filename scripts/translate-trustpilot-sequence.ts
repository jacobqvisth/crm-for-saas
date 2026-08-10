/**
 * One-off: generate the language variants for the Trustpilot AFS trigger
 * sequence.
 *
 * Mirrors POST /api/sequences/[id]/languages exactly — same
 * generateLanguageVariantsForStep helper, same sequential per-step loop (each
 * step is several LLM calls, and firing them all at once hits the rate limit).
 * It exists only because the route needs a browser session and this runs
 * headless.
 *
 * Translation happens here, at authoring time, never at send time: the copy
 * lands as ordinary editable variants flagged ai_generated, so it can be read
 * before it reaches a customer.
 *
 * Idempotent. A language that already has a variant is skipped, not
 * regenerated, so re-running after a partial failure only fills the gaps.
 *
 * Run: npx tsx --env-file=.env.local scripts/translate-trustpilot-sequence.ts
 */
import { createServiceClient } from "../src/lib/supabase/service";
import { generateLanguageVariantsForStep } from "../src/lib/sequences/generate-language-variants";
import { sequenceLanguages } from "../src/lib/sequences/language";
import type { SequenceSettings } from "../src/lib/database.types";

const SEQUENCE_ID = "2fb382de-bc6d-43a5-a00c-b0df134da403";

async function main() {
  const supabase = createServiceClient();

  const { data: sequence, error: seqError } = await supabase
    .from("sequences")
    .select("id, name, workspace_id, settings")
    .eq("id", SEQUENCE_ID)
    .single();
  if (seqError || !sequence) {
    throw new Error(`sequence lookup failed: ${seqError?.message ?? "not found"}`);
  }

  const settings = sequence.settings as SequenceSettings | null;
  const languages = sequenceLanguages(settings);
  console.log(`sequence: ${sequence.name}`);
  console.log(`languages configured (${languages.length}): ${languages.join(", ")}\n`);
  if (languages.length === 0) {
    throw new Error("no languages configured on the sequence, nothing to do");
  }

  const { data: steps, error: stepError } = await supabase
    .from("sequence_steps")
    .select("id, step_order, subject_override, body_override")
    .eq("sequence_id", SEQUENCE_ID)
    .eq("type", "email")
    .order("step_order", { ascending: true });
  if (stepError) throw new Error(`step lookup failed: ${stepError.message}`);

  const emailSteps = steps ?? [];
  console.log(`email steps: ${emailSteps.length}\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const step of emailSteps) {
    console.log(`--- step ${(step.step_order ?? 0) + 1} (${step.id})`);
    const result = await generateLanguageVariantsForStep(supabase, {
      step,
      workspaceId: sequence.workspace_id,
      settings,
    });

    if (result.error) {
      console.log(`  error: ${result.error}`);
      continue;
    }
    created += result.created.length;
    skipped += result.skipped.length;
    failed += result.failed.length;

    console.log(`  created (${result.created.length}): ${result.created.join(", ") || "-"}`);
    if (result.skipped.length) {
      console.log(`  already had (${result.skipped.length}): ${result.skipped.join(", ")}`);
    }
    for (const f of result.failed) {
      console.log(`  FAILED ${f.language}: ${f.reason}`);
    }
  }

  console.log(`\ntotal created ${created}, skipped ${skipped}, failed ${failed}`);
  if (failed > 0) {
    console.log("re-run to retry the failures; existing variants are left alone");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
