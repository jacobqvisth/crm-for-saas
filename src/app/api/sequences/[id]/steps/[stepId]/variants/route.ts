import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/sequences/[id]/steps/[stepId]/variants
 * List variants for a step.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const supabase = await createClient();
  const { id: sequenceId, stepId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: step } = await supabase
    .from("sequence_steps")
    .select("id, sequence_id, sequences!inner(workspace_id)")
    .eq("id", stepId)
    .eq("sequence_id", sequenceId)
    .single();

  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const { data: variants, error } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ variants: variants ?? [] });
}

/**
 * POST /api/sequences/[id]/steps/[stepId]/variants
 *
 * Create a new variant. If this is the FIRST variant for the step and the
 * step has any content in subject_override / body_override, also seed an
 * "Original" variant from that content so the user sees their existing email
 * as one of the rotation arms (otherwise adding a single variant would
 * silently displace the original).
 *
 * Body: { name, subject?, body_html?, weight?, is_active? }
 * Returns: { variants: <all variants for the step after insert> }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const supabase = await createClient();
  const { id: sequenceId, stepId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    subject?: string;
    body_html?: string;
    weight?: number;
    is_active?: boolean;
  };

  const { data: step } = await supabase
    .from("sequence_steps")
    .select("id, sequence_id, subject_override, body_override, sequences!inner(workspace_id)")
    .eq("id", stepId)
    .eq("sequence_id", sequenceId)
    .single();

  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const workspaceId = (step.sequences as unknown as { workspace_id: string })
    .workspace_id;

  const { count: existingCount } = await supabase
    .from("sequence_step_variants")
    .select("id", { count: "exact", head: true })
    .eq("sequence_step_id", stepId);

  const rows: Array<{
    sequence_step_id: string;
    workspace_id: string;
    name: string;
    subject: string;
    body_html: string;
    weight: number;
    is_active: boolean;
  }> = [];

  const stepHasContent =
    (step.subject_override?.trim() ?? "") !== "" ||
    (step.body_override?.trim() ?? "") !== "";

  if ((existingCount ?? 0) === 0 && stepHasContent) {
    rows.push({
      sequence_step_id: stepId,
      workspace_id: workspaceId,
      name: "Original",
      subject: step.subject_override ?? "",
      body_html: step.body_override ?? "",
      weight: 1,
      is_active: true,
    });
  }

  const requestedName =
    body.name?.trim() ||
    `Variant ${String.fromCharCode(65 + ((existingCount ?? 0) + rows.length))}`;

  rows.push({
    sequence_step_id: stepId,
    workspace_id: workspaceId,
    name: requestedName,
    subject: body.subject ?? "",
    body_html: body.body_html ?? "",
    weight: typeof body.weight === "number" ? body.weight : 1,
    is_active: body.is_active ?? true,
  });

  const { error } = await supabase
    .from("sequence_step_variants")
    .insert(rows);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: allVariants } = await supabase
    .from("sequence_step_variants")
    .select("*")
    .eq("sequence_step_id", stepId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ variants: allVariants ?? [] });
}
