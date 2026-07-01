import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Managed "never call" list for the Call Planner. Workspace-scoped rows of
// kind domain / email / company that are always excluded from the top-contacts
// candidate pool. See src/app/api/calls/planner/route.ts for where they apply.

async function getWorkspaceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .single();
  return data?.workspace_id ?? null;
}

/** Normalise a raw value for a given kind, or return null if it's not valid. */
export function normaliseExclusion(
  kind: "domain" | "email" | "company",
  raw: string,
): { value: string; label: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (kind === "company") {
    // value is the company_id (uuid); label carries the display name.
    return { value: trimmed, label: trimmed };
  }

  const lower = trimmed.toLowerCase();
  if (kind === "email") {
    // Very light check — a full address with a domain part.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
    return { value: lower, label: lower };
  }

  // domain: strip protocol, a leading "@", any path, and a leading "www.".
  const domain = lower
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .split("/")[0]
    .replace(/^www\./, "");
  if (!/^[^\s@]+\.[^\s@]+$/.test(domain)) return null;
  return { value: domain, label: domain };
}

// GET /api/calls/exclusions — list this workspace's exclusions.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const { data, error } = await supabase
    .from("call_exclusions")
    .select("id, kind, value, label, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ exclusions: data ?? [] });
}

const AddSchema = z.object({
  kind: z.enum(["domain", "email", "company"]),
  value: z.string().min(1).max(320),
  label: z.string().max(200).optional(),
});

// POST /api/calls/exclusions — add an exclusion. Idempotent per (kind, value).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const parsed = AddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const norm = normaliseExclusion(parsed.data.kind, parsed.data.value);
  if (!norm) {
    return NextResponse.json(
      { error: `That doesn't look like a valid ${parsed.data.kind}` },
      { status: 400 },
    );
  }
  const label = parsed.data.label?.trim() || norm.label;

  const { data, error } = await supabase
    .from("call_exclusions")
    .upsert(
      { workspace_id: workspaceId, kind: parsed.data.kind, value: norm.value, label },
      { onConflict: "workspace_id, kind, value", ignoreDuplicates: false },
    )
    .select("id, kind, value, label, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ exclusion: data });
}

// DELETE /api/calls/exclusions?id=... — remove an exclusion.
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase
    .from("call_exclusions")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
