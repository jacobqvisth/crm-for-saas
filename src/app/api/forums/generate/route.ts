import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { getForumTarget } from "@/lib/forums/targets";
import { generateForumPost } from "@/lib/forums/generate";
import type { ForumPost, ForumScenario } from "@/lib/forums/types";
import type { Json } from "@/lib/database.types";

const causeSchema = z.object({
  name: z.string(),
  probability: z.number().nullable(),
  severity: z.string().nullable(),
  description: z.string().nullable(),
});

const scenarioSchema = z.object({
  diagnosticId: z.string(),
  carMake: z.string().nullable(),
  carModel: z.string().nullable(),
  carYear: z.number().nullable(),
  mileage: z.number().nullable(),
  description: z.string().nullable(),
  dtcs: z.array(z.string()),
  symptoms: z.array(z.string()),
  country: z.string().nullable(),
  topCauseName: z.string().nullable(),
  topCauseSeverity: z.string().nullable(),
  causes: z.array(causeSchema),
  createdAt: z.string().nullable(),
});

const bodySchema = z.object({
  scenario: scenarioSchema,
  forumTarget: z.string(),
  postType: z.enum(["help_question", "solved_story", "helpful_answer"]),
  mentionLevel: z.enum(["none", "subtle", "explicit"]),
});

// POST /api/forums/generate → { post: ForumPost }
// Generates a forum post from a real scenario + chosen forum/angle, then
// persists it (status=drafted) so it shows on the posts board with copy buttons.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { scenario, forumTarget, postType, mentionLevel } = parsed.data;

  const target = getForumTarget(forumTarget);
  if (!target) {
    return NextResponse.json({ error: "Unknown forum target" }, { status: 400 });
  }

  const result = await generateForumPost({
    scenario: scenario as ForumScenario,
    target,
    postType,
    mentionLevel,
    language: target.language,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  const { data, error } = await supabase
    .from("forum_posts")
    .insert({
      workspace_id: workspaceId,
      diagnostic_id: scenario.diagnosticId,
      scenario_snapshot: scenario as unknown as Json,
      forum_target: forumTarget,
      post_type: postType,
      mention_level: mentionLevel,
      language: target.language,
      generated_title: result.title,
      generated_body: result.body,
      status: "drafted",
      model: result.model,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data as unknown as ForumPost });
}
