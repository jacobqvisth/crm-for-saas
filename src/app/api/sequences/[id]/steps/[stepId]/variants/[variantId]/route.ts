import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/sequences/[id]/steps/[stepId]/variants/[variantId]
 * Update a variant. Body: { name?, subject?, body_html?, weight?, is_active? }
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; stepId: string; variantId: string }>;
  },
) {
  const supabase = await createClient();
  const { id: sequenceId, stepId, variantId } = await params;

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

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.subject === "string") updates.subject = body.subject;
  if (typeof body.body_html === "string") updates.body_html = body.body_html;
  if (typeof body.weight === "number") updates.weight = body.weight;
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: variant } = await supabase
    .from("sequence_step_variants")
    .select("id, sequence_step_id, sequence_steps!inner(sequence_id)")
    .eq("id", variantId)
    .eq("sequence_step_id", stepId)
    .single();

  if (
    !variant ||
    (variant.sequence_steps as unknown as { sequence_id: string }).sequence_id !==
      sequenceId
  ) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const { data: updated, error } = await supabase
    .from("sequence_step_variants")
    .update(updates)
    .eq("id", variantId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ variant: updated });
}

/**
 * DELETE /api/sequences/[id]/steps/[stepId]/variants/[variantId]
 */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; stepId: string; variantId: string }>;
  },
) {
  const supabase = await createClient();
  const { id: sequenceId, stepId, variantId } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: variant } = await supabase
    .from("sequence_step_variants")
    .select("id, sequence_step_id, sequence_steps!inner(sequence_id)")
    .eq("id", variantId)
    .eq("sequence_step_id", stepId)
    .single();

  if (
    !variant ||
    (variant.sequence_steps as unknown as { sequence_id: string }).sequence_id !==
      sequenceId
  ) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("sequence_step_variants")
    .delete()
    .eq("id", variantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
