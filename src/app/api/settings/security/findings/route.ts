import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const PatchBody = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "fixed", "accepted_risk", "wont_fix"]),
});

// GET /api/settings/security/findings — all security findings, ordered by
// severity (critical first) then most-recently-discovered.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("security_findings")
    .select("*")
    .order("discovered_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const findings = [...(data || [])].sort((a, b) => {
    const rankA = SEVERITY_RANK[a.severity] ?? 99;
    const rankB = SEVERITY_RANK[b.severity] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return new Date(b.discovered_at).getTime() - new Date(a.discovered_at).getTime();
  });

  return NextResponse.json({ findings });
}

// PATCH /api/settings/security/findings — update a finding's status.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { id, status } = parsed.data;

  const { data: finding, error } = await supabase
    .from("security_findings")
    .update({
      status,
      fixed_at: status === "fixed" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ finding });
}
