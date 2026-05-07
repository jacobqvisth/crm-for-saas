import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PatchBody = z
  .object({
    skip_auto_followup: z.boolean().optional(),
    do_not_contact: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (companyErr) return NextResponse.json({ error: companyErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", company.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.skip_auto_followup !== undefined)
    update.skip_auto_followup = parsed.data.skip_auto_followup;
  if (parsed.data.do_not_contact !== undefined)
    update.do_not_contact = parsed.data.do_not_contact;

  const { data, error } = await supabase
    .from("companies")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", company.workspace_id)
    .select("id, skip_auto_followup, do_not_contact")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
