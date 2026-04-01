import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

type ProfileInput = {
  person_id: string;
  full_name: string;
  current_job_title?: string;
  headline?: string;
  company_name: string;
  company_industry?: string;
  company_employee_range?: string;
  location_country?: string;
  location_city?: string;
};

type VerdictResult = {
  person_id: string;
  verdict: "good" | "maybe" | "poor";
  reason: string;
};

type AiSettings = {
  icp_prompt: string | null;
  filter_enabled: boolean;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const { data: aiSettings } = await (supabase as any)    .from("workspace_ai_settings")
    .select("icp_prompt, filter_enabled")
    .eq("workspace_id", membership.workspace_id)
    .single() as { data: AiSettings | null };

  if (!aiSettings || !aiSettings.filter_enabled) {
    return NextResponse.json({ error: "filter_disabled" }, { status: 400 });
  }

  if (!aiSettings.icp_prompt || aiSettings.icp_prompt.trim() === "") {
    return NextResponse.json({ error: "no_icp_prompt" }, { status: 400 });
  }

  const body = await request.json();
  const profiles: ProfileInput[] = body.profiles;

  if (!profiles || profiles.length === 0) {
    return NextResponse.json({ verdicts: [] });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: `You are an ICP (Ideal Customer Profile) evaluator for a B2B sales team.

${aiSettings.icp_prompt}

You will receive a JSON array of prospect profiles. For each profile, evaluate whether they match the ICP described above and return a JSON array of verdicts.

Rules:
- verdict must be exactly one of: "good", "maybe", or "poor"
- reason must be max 12 words, plain English, no punctuation at the end
- Copy person_id exactly from the input
- Return ONLY a valid JSON array. No explanation, no markdown, no code fences.`,
      messages: [
        {
          role: "user",
          content: `Evaluate these prospects:\n${JSON.stringify(profiles, null, 2)}`,
        },
      ],
    });

    const rawText =
      response.content[0].type === "text" ? response.content[0].text : "";

    let verdicts: VerdictResult[];
    try {
      verdicts = JSON.parse(rawText);
    } catch {
      verdicts = profiles.map((p) => ({
        person_id: p.person_id,
        verdict: "maybe" as const,
        reason: "Could not evaluate",
      }));
    }

    return NextResponse.json({ verdicts });
  } catch {
    return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });
  }
}
