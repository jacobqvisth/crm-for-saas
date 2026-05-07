import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  VISIT_OUTCOMES,
  type FieldVisitsSettings,
  type VisitOutcome,
  readFieldVisitsSettings,
} from "@/lib/routes/visits";
import type { Json } from "@/lib/database.types";

const SequenceByOutcome = z.object(
  Object.fromEntries(
    VISIT_OUTCOMES.map((o) => [o, z.string().uuid().nullable().optional()]),
  ) as Record<VisitOutcome, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
);

const Body = z.object({
  auto_followup_enabled: z.boolean(),
  sequence_by_outcome: SequenceByOutcome.optional(),
});

async function resolveWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return { error: NextResponse.json({ error: "No workspace" }, { status: 404 }) };
  }
  return { workspaceId: membership.workspace_id };
}

export async function GET() {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", auth.workspaceId)
    .maybeSingle();

  const fv = readFieldVisitsSettings(workspace?.settings);
  return NextResponse.json({
    auto_followup_enabled: fv.auto_followup_enabled !== false,
    sequence_by_outcome: fv.sequence_by_outcome ?? {},
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await resolveWorkspace(supabase);
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Strip null/undefined entries from sequence_by_outcome.
  const cleanedSeq: Partial<Record<VisitOutcome, string>> = {};
  if (parsed.data.sequence_by_outcome) {
    for (const [k, v] of Object.entries(parsed.data.sequence_by_outcome)) {
      if (typeof v === "string" && v.length > 0) {
        cleanedSeq[k as VisitOutcome] = v;
      }
    }
  }

  const fieldVisits: FieldVisitsSettings = {
    auto_followup_enabled: parsed.data.auto_followup_enabled,
    sequence_by_outcome: cleanedSeq,
  };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", auth.workspaceId)
    .maybeSingle();

  const existing =
    workspace?.settings && typeof workspace.settings === "object" && !Array.isArray(workspace.settings)
      ? (workspace.settings as Record<string, Json>)
      : {};

  const merged: Record<string, Json> = {
    ...existing,
    field_visits: fieldVisits as unknown as Json,
  };

  const { error } = await supabase
    .from("workspaces")
    .update({ settings: merged as unknown as Json })
    .eq("id", auth.workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, field_visits: fieldVisits });
}
