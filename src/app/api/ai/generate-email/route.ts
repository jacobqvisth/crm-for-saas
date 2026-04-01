import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

type PersonaAngle = "shop_owner" | "service_advisor" | "technician";

type GenerateEmailRequest = {
  workspaceId: string;
  personaAngle: PersonaAngle;
  contactContext: {
    firstName?: string;
    lastName?: string;
    title?: string;
    company?: string;
    industry?: string;
    city?: string;
    country?: string;
  };
  stepNumber: number;
  sequenceName?: string;
  existingTemplate?: {
    subject: string;
    body: string;
  };
};

const PERSONA_CONTEXT: Record<PersonaAngle, string> = {
  shop_owner: `The recipient is a shop owner or workshop manager.
Key pain points: staff turnover, diagnostic bottlenecks, low throughput, rising costs, competing with dealer workshops.
Key benefits to emphasize: faster vehicle turnaround, fewer comebacks, staff efficiency, clear ROI in hours saved per week.
Tone: business outcome focused, peer-to-peer, respect their time.`,

  service_advisor: `The recipient is a service advisor or service manager.
Key pain points: communicating with technicians, tracking job status, customer complaints about wait times, manual paperwork.
Key benefits to emphasize: real-time job visibility, automatic status updates, digital inspection reports, faster approvals.
Tone: workflow improvement focused, practical, show how their day gets easier.`,

  technician: `The recipient is a lead technician or workshop technical manager.
Key pain points: complex modern vehicles (EVs, ADAS), fragmented diagnostic tools, time wasted on documentation.
Key benefits to emphasize: AI-assisted DTC interpretation, guided repair steps, all data in one place, faster diagnosis on unfamiliar models.
Tone: technically credible, peer-to-peer, show you understand their world.`,
};

const PRODUCT_CONTEXT = `
Product: Wrenchlane — AI-powered workshop management software for automotive repair shops.
What it does: Replaces fragmented tools (scan tools, paper job cards, SMS to customers) with a single platform.
Core modules: AI diagnostics assistant, digital job cards, technician task queue, service advisor dashboard, customer communication.
Target market: Independent automotive workshops in the Nordics (Sweden, Norway, Denmark, Finland), 3–30 employees.
Key differentiator: AI that interprets DTCs, suggests root causes, and guides technicians — not just a digital clipboard.
Competitive context: Most Nordic shops use outdated SMS or basic workshop software with no AI. We are entering a greenfield.
`;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: GenerateEmailRequest = await request.json();
  const { workspaceId } = body;

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

  // Rate limiting: check daily count
  const today = new Date().toISOString().split("T")[0];

  const { data: aiSettings } = await (supabase as any)
    .from("workspace_ai_settings")
    .select("daily_email_gen_count, daily_email_gen_date")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const todayCount =
    aiSettings?.daily_email_gen_date === today
      ? (aiSettings.daily_email_gen_count || 0)
      : 0;

  if (todayCount >= 50) {
    return NextResponse.json(
      {
        error:
          "Daily limit of 50 AI email generations reached. Resets at midnight.",
      },
      { status: 429 }
    );
  }

  // Build prompts
  const isPersonalizationMode = !!body.existingTemplate;
  const stepContext =
    body.stepNumber === 1
      ? "This is a first-touch cold email. Keep it short (3–5 sentences max), curious, not salesy."
      : `This is follow-up #${body.stepNumber} in a sequence. Reference that you've reached out before. Keep it even shorter (2–3 sentences).`;

  const contactLine = [
    body.contactContext.firstName && `First name: ${body.contactContext.firstName}`,
    body.contactContext.title && `Title: ${body.contactContext.title}`,
    body.contactContext.company && `Company: ${body.contactContext.company}`,
    body.contactContext.city &&
      `Location: ${body.contactContext.city}${body.contactContext.country ? ", " + body.contactContext.country : ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are an expert B2B cold email writer for Wrenchlane.

${PRODUCT_CONTEXT}

Target persona for this email:
${PERSONA_CONTEXT[body.personaAngle]}

Rules:
- Write in plain, conversational English (not Swedish — the tool is sold in Nordic markets but emails are in English)
- NO buzzwords like "revolutionize", "game-changer", "leverage", "synergy"
- DO NOT mention "AI" in the subject line — it triggers spam filters
- Subject line: 5–8 words, plain language, no exclamation marks
- Body: short paragraphs, max 3–4 sentences each, exactly 1 soft CTA at the end (not "book a demo" — try "worth a quick chat?" or "open to a 15-min call?")
- Use {{first_name}} as the salutation placeholder
- Return ONLY valid JSON: {"subject": "...", "body": "..."}
- Body should be HTML using only <p> tags. No bold, no headers, no lists.`;

  const userMessage = isPersonalizationMode
    ? `Personalize this existing email for the specific contact below. Keep the structure but tailor the language to their context.

Contact context:
${contactLine || "(no specific data available)"}

Original template:
Subject: ${body.existingTemplate!.subject}
Body: ${body.existingTemplate!.body}

Return the personalized version as JSON: {"subject": "...", "body": "..."}`
    : `Write a cold outreach email.

Contact context:
${contactLine || "(no specific data available)"}

${stepContext}
${body.sequenceName ? `Sequence name: ${body.sequenceName}` : ""}

Return the email as JSON: {"subject": "...", "body": "..."}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text : "";

    let parsed: { subject: string; body: string };
    try {
      const cleaned = rawText
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid output. Try again." },
        { status: 500 }
      );
    }

    // Increment daily count (non-fatal if it fails)
    await (supabase as any)
      .from("workspace_ai_settings")
      .upsert(
        {
          workspace_id: workspaceId,
          daily_email_gen_count: todayCount + 1,
          daily_email_gen_date: today,
        },
        { onConflict: "workspace_id" }
      );

    return NextResponse.json({ subject: parsed.subject, body: parsed.body });
  } catch {
    return NextResponse.json(
      { error: "AI service unavailable. Try again." },
      { status: 500 }
    );
  }
}
