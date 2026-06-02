import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { resolveWorkspace } from "@/lib/roadmap/server";
import { gatherEvidence, formatEvidence } from "@/lib/roadmap/evidence";
import { ITEM_STATUSES } from "@/lib/roadmap/types";

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

const bodySchema = z.object({ roadmap_id: z.string().uuid() });

export interface SuggestionOut {
  id: string;
  title: string;
  group: string;
  current_status: string | null;
  suggested_status: string;
  progress_note: string;
  confidence: "low" | "medium" | "high";
}

export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI is not configured" }, { status: 503 });
  }

  // Load the board's groups + items.
  const [{ data: board }, { data: groups }, { data: items }] = await Promise.all([
    supabase.from("roadmaps").select("id, name").eq("id", parsed.data.roadmap_id).eq("workspace_id", workspaceId).single(),
    supabase.from("roadmap_groups").select("id, name").eq("roadmap_id", parsed.data.roadmap_id).eq("workspace_id", workspaceId),
    supabase
      .from("roadmap_items")
      .select("id, title, group_id, status, progress_note, start_date, end_date")
      .eq("roadmap_id", parsed.data.roadmap_id)
      .eq("workspace_id", workspaceId),
  ]);

  if (!board) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  if (!items || items.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const itemById = new Map(items.map((it) => [it.id, it]));

  const evidence = await gatherEvidence(workspaceId);
  const evidenceText = formatEvidence(evidence);

  const itemsBlock = items
    .map((it) =>
      JSON.stringify({
        id: it.id,
        group: groupName.get(it.group_id) ?? "",
        title: it.title,
        current_status: it.status,
        current_note: it.progress_note,
        dates: `${it.start_date}..${it.end_date}`,
      })
    )
    .join("\n");

  const system = `You are a product-operations analyst for Wrenchlane (a SaaS for auto-repair workshops). You are given a marketing roadmap (a list of plan items grouped into swimlanes) and a sweep of REAL internal CRM data. Infer, for EVERY item, how far along it actually is, grounded ONLY in the provided evidence.

Rules:
- Choose suggested_status from exactly: ${ITEM_STATUSES.map((s) => `"${s}"`).join(", ")}.
- "Done" only with strong evidence of completion; "In progress" when there is partial/early evidence (e.g. a review snapshot exists, some outreach has gone out, a sequence is active); "Not started" when there is no internal signal; "Blocked" only if evidence implies a blocker.
- progress_note: ONE short sentence (max ~140 chars) citing the concrete signal (numbers, platform names, counts). If no signal, say so plainly (e.g. "No internal signal found yet.").
- confidence: "high" if evidence directly maps to the item, "medium" if inferred, "low" if guessing / no data.
- Map fuzzy titles to evidence sensibly: e.g. "Google Review" ↔ google-business review snapshot; "Trustpilot" ↔ trustpilot; "G2, Capterra…" ↔ g2/capterra/getapp/software-advice; language items ("In German Language") ↔ outreach in that language; country email items ↔ outreach to those countries; "Google Max Campaign" ↔ google_ads source status; "Activation" ↔ activated users; social items (Tiktok, Youtube, influencers, official account) usually have NO internal signal → Not started, low confidence.
- Do NOT invent evidence. Prefer "Not started" over an unsupported "Done".

Return ONLY a JSON array (no prose, no code fences). One object per item: {"id": string, "suggested_status": string, "progress_note": string, "confidence": "low"|"medium"|"high"}.`;

  const userMessage = `# Roadmap: ${board.name}

## Items (one JSON object per line)
${itemsBlock}

# Internal evidence
${evidenceText}

Return the JSON array now.`;

  let rawText: string;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userMessage }],
    });
    rawText = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch {
    return NextResponse.json({ error: "AI service unavailable. Try again." }, { status: 502 });
  }

  let parsedArr: unknown;
  try {
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    parsedArr = JSON.parse(cleaned);
    if (!Array.isArray(parsedArr)) throw new Error("not an array");
  } catch {
    return NextResponse.json({ error: "AI returned invalid output. Try again." }, { status: 502 });
  }

  const statuses = new Set<string>(ITEM_STATUSES);
  const confidences = new Set(["low", "medium", "high"]);
  const suggestions: SuggestionOut[] = [];
  for (const raw of parsedArr as Record<string, unknown>[]) {
    const id = typeof raw?.id === "string" ? raw.id : null;
    const item = id ? itemById.get(id) : null;
    if (!item) continue;
    const suggested_status = typeof raw.suggested_status === "string" && statuses.has(raw.suggested_status)
      ? raw.suggested_status
      : null;
    if (!suggested_status) continue;
    const confidence = typeof raw.confidence === "string" && confidences.has(raw.confidence)
      ? (raw.confidence as SuggestionOut["confidence"])
      : "low";
    suggestions.push({
      id: item.id,
      title: item.title,
      group: groupName.get(item.group_id) ?? "",
      current_status: item.status,
      suggested_status,
      progress_note: typeof raw.progress_note === "string" ? raw.progress_note.slice(0, 280) : "",
      confidence,
    });
  }

  return NextResponse.json({ suggestions });
}
