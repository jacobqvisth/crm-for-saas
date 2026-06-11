import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { resolveListContactIds } from "@/lib/lists/filter-query";

async function getWorkspaceId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.workspace_id ?? null;
}

// GET /api/calls/lists — calling lists (contact_lists with purpose='calling')
// plus a resolved member count for each.
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const { data: lists, error } = await supabase
    .from("contact_lists")
    .select("id, name, description, is_dynamic, filters, created_at, updated_at, workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("purpose", "calling")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withCounts = await Promise.all(
    (lists ?? []).map(async (l) => {
      let memberCount = 0;
      try {
        memberCount = (await resolveListContactIds(supabase, l)).length;
      } catch {
        memberCount = 0;
      }
      const { filters, ...rest } = l;
      void filters;
      return { ...rest, memberCount };
    }),
  );

  return NextResponse.json({ lists: withCounts });
}

const CreateListBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  isDynamic: z.boolean().default(false),
  filters: z.unknown().optional(),
});

// POST /api/calls/lists — create a calling list. Reuses contact_lists with
// purpose='calling' so the existing filter-builder + members table apply.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const parsed = CreateListBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("contact_lists")
    .insert({
      workspace_id: workspaceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      is_dynamic: parsed.data.isDynamic,
      filters: parsed.data.isDynamic ? ((parsed.data.filters as Json) ?? null) : null,
      purpose: "calling",
    })
    .select("id, name, description, is_dynamic, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ list: data }, { status: 201 });
}
