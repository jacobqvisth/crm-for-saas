import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";

export type StepVariant = Tables<"sequence_step_variants">;

export interface ResolvedVariant {
  variantId: string | null;
  subject: string;
  bodyHtml: string;
}

interface StepLike {
  id: string;
  subject_override: string | null;
  body_override: string | null;
  template_id?: string | null;
}

interface TemplateLike {
  subject: string;
  body_html: string;
}

/**
 * Resolve content for one queue row. With ≥1 active variant, pick the
 * least-used by `sends_count / max(1, weight)` (deterministic tie-break on
 * id). With none, fall back to the step's own override / template.
 *
 * Caller is responsible for bumping sends_count on the picked variant after
 * the queue row is persisted.
 */
export function pickVariant(
  step: StepLike,
  variants: StepVariant[],
  template: TemplateLike | null,
): ResolvedVariant {
  const active = variants.filter((v) => v.is_active && v.weight > 0);

  if (active.length === 0) {
    let subject = step.subject_override ?? "";
    let bodyHtml = step.body_override ?? "";
    if (template && step.template_id) {
      subject = step.subject_override || template.subject;
      bodyHtml = step.body_override || template.body_html;
    }
    return { variantId: null, subject, bodyHtml };
  }

  const picked = [...active].sort((a, b) => {
    const scoreA = a.sends_count / Math.max(1, a.weight);
    const scoreB = b.sends_count / Math.max(1, b.weight);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.id.localeCompare(b.id);
  })[0];

  return {
    variantId: picked.id,
    subject: picked.subject,
    bodyHtml: picked.body_html,
  };
}

/**
 * Stateful picker for batch enrollment. Maintains in-memory sends_count
 * deltas per variant so 500 picks against the same step produce a true
 * round-robin (not 500 copies of "the lowest-count one"). Caller calls
 * `flushDeltas()` once at the end to persist.
 */
export function createBatchVariantPicker(
  variantsByStepId: Map<string, StepVariant[]>,
) {
  const mutableByStep = new Map<string, StepVariant[]>();
  for (const [stepId, variants] of variantsByStepId) {
    mutableByStep.set(
      stepId,
      variants.map((v) => ({ ...v })),
    );
  }
  const countDeltas = new Map<string, number>();

  return {
    pickForStep(step: StepLike, template: TemplateLike | null): ResolvedVariant {
      const variants = mutableByStep.get(step.id) ?? [];
      const pick = pickVariant(step, variants, template);
      if (pick.variantId) {
        countDeltas.set(
          pick.variantId,
          (countDeltas.get(pick.variantId) ?? 0) + 1,
        );
        const v = variants.find((x) => x.id === pick.variantId);
        if (v) v.sends_count++;
      }
      return pick;
    },
    deltas: countDeltas,
  };
}

/**
 * Persist accumulated sends_count deltas. Uses the increment_variant_sends
 * RPC so the writes are atomic increments rather than read-modify-write
 * (which would race the cron + concurrent enrollments).
 */
export async function flushSendCountDeltas(
  supabase: SupabaseClient<Database>,
  countDeltas: Map<string, number>,
): Promise<void> {
  for (const [variantId, delta] of countDeltas) {
    if (delta <= 0) continue;
    await supabase.rpc("increment_variant_sends", {
      p_variant_id: variantId,
      p_delta: delta,
    });
  }
}

/**
 * Single-row send count bump for per-row callers (process-emails materializes
 * one queue row at a time when a contact advances to the next step).
 */
export async function bumpVariantSendCount(
  supabase: SupabaseClient<Database>,
  variantId: string,
): Promise<void> {
  await supabase.rpc("increment_variant_sends", {
    p_variant_id: variantId,
    p_delta: 1,
  });
}

/**
 * Bulk fetch variants for every step in a sequence, indexed by step id.
 * Called once per enrollment batch.
 */
export async function fetchVariantsByStepId(
  supabase: SupabaseClient<Database>,
  stepIds: string[],
): Promise<Map<string, StepVariant[]>> {
  const byStepId = new Map<string, StepVariant[]>();
  if (stepIds.length === 0) return byStepId;

  const { data } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .in("sequence_step_id", stepIds);

  for (const v of (data ?? []) as StepVariant[]) {
    const arr = byStepId.get(v.sequence_step_id) ?? [];
    arr.push(v);
    byStepId.set(v.sequence_step_id, arr);
  }
  return byStepId;
}

/**
 * Per-row variant fetch for process-emails (next-step materialization). Pulls
 * variants for one step at a time since the cron processes queue rows
 * individually.
 */
export async function fetchVariantsForStep(
  supabase: SupabaseClient<Database>,
  stepId: string,
): Promise<StepVariant[]> {
  const { data } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId);
  return (data ?? []) as StepVariant[];
}
