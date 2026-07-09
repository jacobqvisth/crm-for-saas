import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";

const ALLOWED_TOKENS = [
  "first_name",
  "first_name_optional",
  "last_name",
  "email",
  "company_name",
  "phone",
  "title",
  "city",
  "country",
  "sender_first_name",
  "sender_company",
  "unsubscribe_link",
];

// One batch costs one slot. The daily cap is now interpreted as batches/day —
// see the comment alongside the existing /api/ai/generate-email rate limit.
const DAILY_BATCH_CAP = 20;
const MIN_BATCH = 2;
const MAX_BATCH = 10;

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

type GenerateVariantsRequest = {
  workspaceId: string;
  sequenceId: string;
  stepId: string;
  count: number;
  personaAngle?: PersonaAngle;
};

type GeneratedVariant = {
  name: string;
  subject: string;
  body: string;
};

const PERSONA_CONTEXT: Record<PersonaAngle, string> = {
  shop_owner: `The recipient is a shop owner or workshop manager.
Pain points: staff turnover, diagnostic bottlenecks, low throughput, rising costs.
Tone: business outcome focused, peer-to-peer, respect their time.`,
  service_advisor: `The recipient is a service advisor or service manager.
Pain points: communicating with technicians, tracking job status, customer wait times.
Tone: workflow improvement focused, practical, show how their day gets easier.`,
  technician: `The recipient is a lead technician or workshop technical manager.
Pain points: complex modern vehicles (EVs, ADAS), fragmented diagnostic tools.
Tone: technically credible, peer-to-peer.`,
};

const PRODUCT_CONTEXT = `
Product: Wrenchlane — AI-powered workshop management software for automotive repair shops.
Target market: Independent automotive workshops in the Nordics, 3–30 employees.
Key differentiator: AI that interprets DTCs and guides technicians — not just a digital clipboard.
`;

function extractTokens(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

function findInvalidTokens(text: string): string[] {
  return extractTokens(text).filter((t) => !ALLOWED_TOKENS.includes(t));
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as GenerateVariantsRequest;
  const { workspaceId, sequenceId, stepId } = body;
  const count = Math.max(MIN_BATCH, Math.min(MAX_BATCH, body.count ?? 5));

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load step + cta_lock + existing variants (used as context for variation)
  const { data: step } = await supabase
    .from("sequence_steps")
    .select("id, sequence_id, subject_override, body_override, cta_lock, step_order")
    .eq("id", stepId)
    .eq("sequence_id", sequenceId)
    .single();
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const { data: existingVariants } = await supabase
    .from("sequence_step_variants")
    .select("name, subject, body_html")
    .eq("sequence_step_id", stepId);

  // Daily batch counter — one batch costs one slot regardless of count.
  const today = new Date().toISOString().split("T")[0];
  const { data: aiSettings } = await (supabase as never as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { daily_email_gen_count: number; daily_email_gen_date: string | null } | null }>;
        };
      };
    };
  })
    .from("workspace_ai_settings")
    .select("daily_email_gen_count, daily_email_gen_date")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const todayCount =
    aiSettings?.daily_email_gen_date === today
      ? aiSettings.daily_email_gen_count || 0
      : 0;

  if (todayCount >= DAILY_BATCH_CAP) {
    return NextResponse.json(
      {
        error: `Daily limit of ${DAILY_BATCH_CAP} AI batches reached. Resets at midnight.`,
      },
      { status: 429 },
    );
  }

  // Build the prompt
  const persona = body.personaAngle ?? "shop_owner";
  const ctaLock = step.cta_lock?.trim() || null;
  const baseSubject = step.subject_override?.trim() ?? "";
  const baseBody = step.body_override?.trim() ?? "";

  const existingBlock = (existingVariants ?? [])
    .map(
      (v, i) =>
        `### Existing variant ${i + 1}: ${v.name}\nSubject: ${v.subject}\nBody: ${v.body_html}`,
    )
    .join("\n\n");

  const systemPrompt = `You are an expert B2B cold email writer for Wrenchlane.

${PRODUCT_CONTEXT}

Target persona:
${PERSONA_CONTEXT[persona]}

You are generating ${count} ALTERNATE versions of a single sequence step. Your job is to vary surface form (opener, sentence structure, word choice, length within ±25%) while PRESERVING:
- The intent and ask
- The recipient's takeaway
${ctaLock ? `- The CTA must include this phrase verbatim: "${ctaLock}"` : "- The soft CTA at the end (single, conversational, e.g. \"worth a quick chat?\")"}
- Personalization tokens. ALL tokens used MUST be from this allowlist (no other {{...}} tokens permitted): ${ALLOWED_TOKENS.join(", ")}

Output rules:
- Each variant must be substantially different from every other variant AND from any existing variant shown below — different opener, different rhythm, different word choices. Do NOT just rephrase one sentence.
- Subject lines: 5–8 words, no exclamation marks, do NOT mention "AI"
- ${NO_LONG_DASH_INSTRUCTION}
- Body: HTML with only <p> tags. No bold, no lists, no headers. Short paragraphs (max 3–4 sentences each).
- Salutation: write it exactly as "Hi{{first_name_optional}}," (no space before the token). At send time this renders to "Hi Jane," when the contact has a first name and "Hi," when they don't — never use the bare {{first_name}} token in the salutation, and never invent your own greeting
- Return ONLY valid JSON: an array of exactly ${count} objects, each { "name": string, "subject": string, "body": string }
- "name" should be a 1–3 word evocative label (e.g. "Curious opener", "Pain-led", "Peer reference")`;

  const userMessage = `Generate ${count} variants for sequence step ${step.step_order}${baseSubject || baseBody ? "" : " (no base content provided — invent from product context)"}.

${
  baseSubject || baseBody
    ? `## Base content
Subject: ${baseSubject}
Body: ${baseBody}`
    : ""
}

${existingBlock ? `## Existing variants (do NOT repeat or near-repeat any of these)\n\n${existingBlock}` : ""}

Return the JSON array now.`;

  let rawText: string;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    rawText = response.content[0].type === "text" ? response.content[0].text : "";
  } catch {
    return NextResponse.json(
      { error: "AI service unavailable. Try again." },
      { status: 500 },
    );
  }

  let parsed: GeneratedVariant[];
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("expected array");
  } catch {
    return NextResponse.json(
      { error: "AI returned invalid output. Try again." },
      { status: 500 },
    );
  }

  // Token allowlist enforcement — drop any variant that uses a token outside
  // the allowlist (commonly the AI invents tokens like {{full_company_name}}).
  // We report the count so the UI can surface "3 of 5 generated" if some
  // were dropped.
  const validVariants: GeneratedVariant[] = [];
  let invalidTokenCount = 0;
  for (const v of parsed) {
    if (
      typeof v?.subject !== "string" ||
      typeof v?.body !== "string" ||
      typeof v?.name !== "string"
    ) {
      continue;
    }
    const allText = `${v.subject} ${v.body}`;
    const invalid = findInvalidTokens(allText);
    if (invalid.length > 0) {
      invalidTokenCount++;
      continue;
    }
    // CTA-lock enforcement (textual substring match against body+subject).
    if (ctaLock) {
      const haystack = `${v.subject} ${v.body}`.toLowerCase();
      if (!haystack.includes(ctaLock.toLowerCase())) {
        continue;
      }
    }
    validVariants.push({
      ...v,
      subject: stripLongDashes(v.subject),
      body: stripLongDashes(v.body),
    });
  }

  if (validVariants.length === 0) {
    return NextResponse.json(
      {
        error:
          invalidTokenCount > 0
            ? `Every generated variant used disallowed tokens. Try again.`
            : ctaLock
              ? `The CTA lock "${ctaLock}" wasn't honored. Try again or relax it.`
              : "AI produced no usable variants. Try again.",
      },
      { status: 500 },
    );
  }

  // Bump the daily counter (one batch = one slot). Non-fatal on failure.
  await (supabase as never as {
    from: (t: string) => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => Promise<unknown>;
    };
  })
    .from("workspace_ai_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        daily_email_gen_count: todayCount + 1,
        daily_email_gen_date: today,
      },
      { onConflict: "workspace_id" },
    );

  return NextResponse.json({
    variants: validVariants,
    requestedCount: count,
    rejectedForInvalidTokens: invalidTokenCount,
    rejectedForCtaLockMiss: parsed.length - validVariants.length - invalidTokenCount,
    remainingBudget: Math.max(0, DAILY_BATCH_CAP - (todayCount + 1)),
  });
}
