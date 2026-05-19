import { describe, it, expect } from "vitest";
import {
  pickVariant,
  createBatchVariantPicker,
  type StepVariant,
} from "./variants";

const baseStep = {
  id: "step-1",
  subject_override: "Step subject",
  body_override: "<p>Step body</p>",
  template_id: null as string | null,
};

function v(
  id: string,
  overrides: Partial<StepVariant> = {},
): StepVariant {
  return {
    id,
    sequence_step_id: "step-1",
    workspace_id: "ws-1",
    name: id,
    subject: `subj-${id}`,
    body_html: `<p>body-${id}</p>`,
    weight: 1,
    is_active: true,
    ai_generated: false,
    ai_generation_model: null,
    ai_parent_variant_id: null,
    sends_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pickVariant", () => {
  it("falls back to step.subject_override / body_override when no variants exist", () => {
    const result = pickVariant(baseStep, [], null);
    expect(result.variantId).toBeNull();
    expect(result.subject).toBe("Step subject");
    expect(result.bodyHtml).toBe("<p>Step body</p>");
  });

  it("falls back to template when step has template_id but no overrides", () => {
    const result = pickVariant(
      { ...baseStep, subject_override: "", body_override: "", template_id: "t1" },
      [],
      { subject: "TPL subj", body_html: "<p>TPL body</p>" },
    );
    expect(result.subject).toBe("TPL subj");
    expect(result.bodyHtml).toBe("<p>TPL body</p>");
  });

  it("override wins over template when both are present", () => {
    const result = pickVariant(
      { ...baseStep, subject_override: "Override subj", template_id: "t1" },
      [],
      { subject: "TPL subj", body_html: "<p>TPL body</p>" },
    );
    expect(result.subject).toBe("Override subj");
  });

  it("returns the single variant when only one is active", () => {
    const result = pickVariant(baseStep, [v("a")], null);
    expect(result.variantId).toBe("a");
    expect(result.subject).toBe("subj-a");
  });

  it("skips inactive variants", () => {
    const result = pickVariant(
      baseStep,
      [v("a", { is_active: false }), v("b")],
      null,
    );
    expect(result.variantId).toBe("b");
  });

  it("skips weight=0 variants", () => {
    const result = pickVariant(
      baseStep,
      [v("a", { weight: 0 }), v("b")],
      null,
    );
    expect(result.variantId).toBe("b");
  });

  it("falls back when every variant is disabled", () => {
    const result = pickVariant(
      baseStep,
      [v("a", { is_active: false }), v("b", { weight: 0 })],
      null,
    );
    expect(result.variantId).toBeNull();
    expect(result.subject).toBe("Step subject");
  });

  it("picks lowest sends_count first", () => {
    const result = pickVariant(
      baseStep,
      [
        v("a", { sends_count: 5 }),
        v("b", { sends_count: 2 }),
        v("c", { sends_count: 10 }),
      ],
      null,
    );
    expect(result.variantId).toBe("b");
  });

  it("respects weight when picking least-used", () => {
    // a: 4 sends / weight 2 = score 2
    // b: 3 sends / weight 1 = score 3
    // Should pick a even though it has more sends.
    const result = pickVariant(
      baseStep,
      [v("a", { weight: 2, sends_count: 4 }), v("b", { sends_count: 3 })],
      null,
    );
    expect(result.variantId).toBe("a");
  });

  it("tie-breaks deterministically on id", () => {
    const r1 = pickVariant(baseStep, [v("b"), v("a")], null);
    const r2 = pickVariant(baseStep, [v("a"), v("b")], null);
    expect(r1.variantId).toBe("a");
    expect(r2.variantId).toBe("a");
  });
});

describe("createBatchVariantPicker", () => {
  it("distributes evenly across equal-weight variants", () => {
    const picker = createBatchVariantPicker(
      new Map([["step-1", [v("a"), v("b"), v("c")]]]),
    );
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 9; i++) {
      const pick = picker.pickForStep(baseStep, null);
      if (pick.variantId) counts[pick.variantId]++;
    }
    expect(counts).toEqual({ a: 3, b: 3, c: 3 });
  });

  it("respects weight ratios", () => {
    // w=2, w=1, w=1 over 8 picks → 4 / 2 / 2
    const picker = createBatchVariantPicker(
      new Map([["step-1", [v("a", { weight: 2 }), v("b"), v("c")]]]),
    );
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 8; i++) {
      const pick = picker.pickForStep(baseStep, null);
      if (pick.variantId) counts[pick.variantId]++;
    }
    expect(counts).toEqual({ a: 4, b: 2, c: 2 });
  });

  it("accumulates count deltas matching the picks made", () => {
    const picker = createBatchVariantPicker(
      new Map([["step-1", [v("a"), v("b")]]]),
    );
    for (let i = 0; i < 6; i++) picker.pickForStep(baseStep, null);
    expect(picker.deltas.get("a")).toBe(3);
    expect(picker.deltas.get("b")).toBe(3);
  });

  it("falls back when no variants registered for a step", () => {
    const picker = createBatchVariantPicker(new Map());
    const pick = picker.pickForStep(baseStep, null);
    expect(pick.variantId).toBeNull();
    expect(pick.subject).toBe("Step subject");
    expect(picker.deltas.size).toBe(0);
  });
});
