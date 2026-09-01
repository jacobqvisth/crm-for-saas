import { generateJson } from "@/lib/ai/provider";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";

const MODEL = "claude-sonnet-5";

export type Agreement = "strong" | "partial" | "conflict" | "no_wrenchlane_data";

export interface CompareVerdict {
  agreement: Agreement;
  /** 0-100. How well Wrenchlane's diagnosis matches the factory manual. */
  score: number;
  /** One or two sentences a mechanic can act on. */
  headline: string;
  /** Points both sources make. */
  shared: string[];
  /** In the factory manual, missing from Wrenchlane. */
  only_lemon: string[];
  /** Wrenchlane asserts it, the manual does not support it. */
  only_wrenchlane: string[];
  /** Anything that would cost money to act on wrongly. */
  risk_notes: string[];
}

/**
 * A verdict plus the model that actually produced it.
 *
 * The model is reported rather than assumed because the provider layer can
 * serve this on Gemini instead of Anthropic. The comparison row stores it, and a
 * stored verdict attributed to the wrong model is worse than no attribution:
 * these rows exist to judge diagnosis quality, so the judge has to be named
 * correctly.
 */
export type CompareResult = CompareVerdict & { model: string };

const TOOL = {
  name: "record_comparison",
  description: "Record how the Wrenchlane diagnosis compares to the factory manual entry.",
  input_schema: {
    type: "object" as const,
    properties: {
      agreement: {
        type: "string",
        enum: ["strong", "partial", "conflict"],
        description:
          "strong = same root cause and same subsystem. partial = right subsystem, wrong or vaguer cause. conflict = points at a different component or contradicts the manual.",
      },
      score: { type: "number", description: "0-100 match against the factory manual." },
      headline: { type: "string", description: "One or two sentences, plain language." },
      shared: { type: "array", items: { type: "string" } },
      only_lemon: { type: "array", items: { type: "string" } },
      only_wrenchlane: { type: "array", items: { type: "string" } },
      risk_notes: {
        type: "array",
        items: { type: "string" },
        description:
          "Anything expensive or misleading, especially a part the manual explicitly says not to replace.",
      },
    },
    required: ["agreement", "score", "headline", "shared", "only_lemon", "only_wrenchlane", "risk_notes"],
  },
};

/**
 * The model returns the score as either 0-100 or a 0-1 fraction depending on
 * the run. Rounding a fraction silently stores 0, so scale it first. Same trap
 * as formatPercent on the DTC Codes page.
 */
function normaliseScore(raw: unknown, agreement?: Agreement): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  let s = Math.max(0, Math.min(100, Math.round(scaled)));
  // A score must never contradict its own label. "conflict 100" is meaningless,
  // and n === 1 is genuinely ambiguous between 1/100 and 100%.
  if (agreement === "conflict") s = Math.min(s, 29);
  if (agreement === "partial") s = Math.min(Math.max(s, 30), 69);
  if (agreement === "strong") s = Math.max(s, 70);
  return s;
}

export interface CompareInput {
  code: string;
  vehicle: string;
  lemonText: string;
  wrenchlaneText: string;
  wrenchlaneCauses: Array<{ name?: string; confidence?: number }>;
}

/**
 * Judge one Wrenchlane diagnosis against the factory manual entry for the same
 * code. The manual is the reference: it is the manufacturer's own definition of
 * what the code means, so where they disagree the manual wins by construction.
 */
export async function compareDiagnoses(input: CompareInput): Promise<CompareResult> {
  const causeList = input.wrenchlaneCauses
    .map((c) => `- ${c.name ?? "unnamed"}${c.confidence != null ? ` (${c.confidence}%)` : ""}`)
    .join("\n");

  const prompt = `You are auditing an AI car-diagnosis product against the factory service manual.

VEHICLE: ${input.vehicle}
FAULT CODE: ${input.code}

=== FACTORY MANUAL (Mercedes, via LEMON). This is the reference. ===
${input.lemonText.slice(0, 6000)}

=== WRENCHLANE AI DIAGNOSIS ===
Ranked causes:
${causeList || "(none returned)"}

Full result:
${input.wrenchlaneText.slice(0, 6000)}

Judge how well the Wrenchlane diagnosis matches the manual.

Rules:
- The manual defines what the code MEANS. If Wrenchlane names a different subsystem, that is a conflict however confident it sounds.
- A CAN communication timeout naming a specific control unit is NOT the same as an internal fault of that control unit. Say so if it conflates them.
- If the manual explicitly warns a component is not at fault and Wrenchlane names it, that belongs in risk_notes.
- Be concrete. Name the control units and components.
- ${NO_LONG_DASH_INSTRUCTION}`;

  const result = await generateJson<CompareVerdict>(
    {
      label: "dtc-lookup/compare",
      anthropicModel: MODEL,
      user: prompt,
      maxTokens: 1500,
    },
    TOOL,
  );
  // This one is called from a script and reports per-code, so a hard failure is
  // the right signal rather than a silently degraded verdict.
  if (!result.ok) throw new Error(result.reason);
  const v = result.data;

  return {
    agreement: v.agreement,
    score: normaliseScore(v.score, v.agreement),
    headline: stripLongDashes(v.headline ?? ""),
    shared: (v.shared ?? []).map(stripLongDashes),
    only_lemon: (v.only_lemon ?? []).map(stripLongDashes),
    only_wrenchlane: (v.only_wrenchlane ?? []).map(stripLongDashes),
    risk_notes: (v.risk_notes ?? []).map(stripLongDashes),
    model: result.model,
  };
}
