import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

type DuplicateRequest = {
  sourceSequenceId: string;
  workspaceId: string;
  targetCountry: string;
  targetCountryName: string;
  targetLanguage: string;
  targetLanguageLabel: string;
  newName: string;
  sourceLanguage?: string;
};

const SYSTEM_PROMPT = `You translate marketing/sales cold emails between European languages for a B2B SaaS called Wrenchlane.
Rules:
- Translate naturally — native-speaker quality, business-professional tone, not literal.
- PRESERVE all HTML tags (<p>, <a>, <br>, etc.) exactly.
- PRESERVE all placeholders like {{first_name}}, {{company}}, {{unsubscribe_url}} — do not translate or reformat them.
- PRESERVE URLs exactly.
- Keep paragraph count and structure identical to the source.
- Translate the subject too.
- Return ONLY valid JSON: {"subject": "...", "body": "..."} — no markdown fences, no commentary.`;

async function translateStep(
  client: Anthropic,
  subject: string,
  body: string,
  targetLanguageLabel: string,
  targetLanguage: string
): Promise<{ subject: string; body: string }> {
  const userMessage = `Translate the following email to ${targetLanguageLabel} (locale code: ${targetLanguage}).

Subject: ${subject}

Body (HTML):
${body}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText =
    response.content[0].type === "text" ? response.content[0].text : "";

  const cleaned = rawText
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned) as { subject: string; body: string };
  return parsed;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: DuplicateRequest = await request.json();
  const {
    sourceSequenceId,
    workspaceId,
    targetLanguage,
    targetLanguageLabel,
    newName,
  } = body;

  // Verify workspace membership
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load source sequence
  const { data: sourceSeq, error: seqError } = await supabase
    .from("sequences")
    .select("*")
    .eq("id", sourceSequenceId)
    .eq("workspace_id", workspaceId)
    .single();

  if (seqError || !sourceSeq) {
    return NextResponse.json({ error: "Source sequence not found" }, { status: 404 });
  }

  // Load source steps
  const { data: steps, error: stepsError } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", sourceSequenceId)
    .order("step_order");

  if (stepsError) {
    return NextResponse.json({ error: "Failed to load source steps" }, { status: 500 });
  }

  const emailSteps = (steps || []).filter(
    (s) =>
      s.type === "email" &&
      ((s.subject_override && s.subject_override.trim()) ||
        (s.body_override && s.body_override.trim()))
  );

  if (emailSteps.length > 20) {
    return NextResponse.json(
      { error: "Sequence has more than 20 email steps — too many to translate in one request." },
      { status: 400 }
    );
  }

  // Create new sequence
  const { data: newSeq, error: newSeqError } = await supabase
    .from("sequences")
    .insert({
      workspace_id: workspaceId,
      name: newName,
      status: "draft" as const,
      settings: sourceSeq.settings,
    })
    .select()
    .single();

  if (newSeqError || !newSeq) {
    return NextResponse.json({ error: "Failed to create new sequence" }, { status: 500 });
  }

  const warnings: string[] = [];
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build translated steps
  const newSteps = await Promise.all(
    (steps || []).map(async (s) => {
      const base = {
        sequence_id: newSeq.id,
        step_order: s.step_order,
        type: s.type,
        delay_days: s.delay_days,
        delay_hours: s.delay_hours,
        template_id: s.template_id,
        subject_override: s.subject_override,
        body_override: s.body_override,
        condition_type: s.condition_type,
        condition_branch_yes: s.condition_branch_yes,
        condition_branch_no: s.condition_branch_no,
      };

      if (s.type !== "email") {
        return base;
      }

      // Template-backed step — copy as-is with warning
      if (s.template_id && !s.subject_override && !s.body_override) {
        warnings.push(
          `Step ${s.step_order} uses a shared template — translate it manually in Templates.`
        );
        return base;
      }

      // Inline email step — translate
      const subject = s.subject_override ?? "";
      const body = s.body_override ?? "";

      if (!subject && !body) {
        return base;
      }

      try {
        const translated = await translateStep(
          client,
          subject,
          body,
          targetLanguageLabel,
          targetLanguage
        );
        return {
          ...base,
          subject_override: translated.subject,
          body_override: translated.body,
        };
      } catch (err) {
        console.error(`Translation failed for step ${s.step_order}:`, err);
        warnings.push(
          `Step ${s.step_order} could not be translated — original text kept.`
        );
        return base;
      }
    })
  );

  // Insert all steps
  if (newSteps.length > 0) {
    const { error: insertError } = await supabase
      .from("sequence_steps")
      .insert(newSteps);

    if (insertError) {
      // Clean up the orphaned sequence
      await supabase.from("sequences").delete().eq("id", newSeq.id);
      return NextResponse.json({ error: "Failed to insert steps" }, { status: 500 });
    }
  }

  return NextResponse.json({ sequenceId: newSeq.id, warnings });
}
