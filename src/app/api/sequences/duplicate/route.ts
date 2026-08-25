import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NO_LONG_DASH_INSTRUCTION, stripLongDashes } from "@/lib/ai/no-long-dash";
import { sameSubjectText } from "@/lib/inbox/translate-outbound";

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
- ${NO_LONG_DASH_INSTRUCTION}
- Return ONLY valid JSON: {"subject": "...", "body": "..."} — no markdown fences, no commentary.`;

const SUBJECT_ONLY_PROMPT = `You translate the subject line of a sales email for a B2B SaaS called Wrenchlane.
Rules:
- Return the subject translated into the requested language, nothing else.
- Do not translate the product name "Wrenchlane". Everything around it MUST be translated.
- PRESERVE placeholders like {{first_name}} exactly.
- ${NO_LONG_DASH_INSTRUCTION}
- Return ONLY the translated subject line. No quotes, no JSON, no commentary.`;

/**
 * Second pass over the subject alone.
 *
 * The combined subject + body call sometimes reads a subject like
 * "WrenchLane - Faster diagnostics" as a brand tagline and hands it back
 * untouched while translating the body perfectly. Asking for the subject on
 * its own, with no body beside it, gets a real translation. Returns null if
 * the retry itself fails, so the caller keeps the first pass.
 */
async function retranslateSubject(
  client: Anthropic,
  subject: string,
  targetLanguageLabel: string,
  targetLanguage: string
): Promise<string | null> {
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: SUBJECT_ONLY_PROMPT,
      messages: [
        {
          role: "user",
          content: `Translate this email subject line to ${targetLanguageLabel} (locale code: ${targetLanguage}). It came back untranslated on the first attempt, so translate it now.\n\n${subject}`,
        },
      ],
    });
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = stripLongDashes(text.trim().replace(/^["']|["']$/g, ""));
    return cleaned || null;
  } catch {
    return null;
  }
}

async function translateStep(
  client: Anthropic,
  subject: string,
  body: string,
  targetLanguageLabel: string,
  targetLanguage: string
): Promise<{ subject: string; body: string; subjectUntranslated: boolean }> {
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
  let outSubject = stripLongDashes(parsed.subject ?? "");

  // Catch the silent half-translation: body in the target language, subject
  // handed straight back. Retry the subject alone, then report it if it still
  // will not move, rather than shipping an English subject on a Czech email.
  let subjectUntranslated = false;
  if (subject.trim() && sameSubjectText(subject, outSubject)) {
    const retried = await retranslateSubject(
      client,
      subject,
      targetLanguageLabel,
      targetLanguage
    );
    if (retried && !sameSubjectText(subject, retried)) {
      outSubject = retried;
    } else {
      subjectUntranslated = true;
    }
  }

  return {
    subject: outSubject,
    body: stripLongDashes(parsed.body),
    subjectUntranslated,
  };
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
        if (translated.subjectUntranslated) {
          warnings.push(
            `Step ${s.step_order} kept its original subject line, the model would not translate it. Fix it by hand before sending.`
          );
        }
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
