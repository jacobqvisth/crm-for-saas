import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const Body = z.object({
  signature_html: z.string().nullable(),
});

const ADMIN_ROLES = ["owner", "admin"] as const;

async function resolveAccess(targetUserId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (user.id === targetUserId) {
    return { user, isSelf: true };
  }

  const { data: callerMemberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id);

  const adminWorkspaceIds = (callerMemberships ?? [])
    .filter((m) => (ADMIN_ROLES as readonly string[]).includes(m.role ?? ""))
    .map((m) => m.workspace_id);

  if (adminWorkspaceIds.length === 0) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const { data: targetMembership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", targetUserId)
    .in("workspace_id", adminWorkspaceIds)
    .limit(1)
    .maybeSingle();

  if (!targetMembership) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user, isSelf: false };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const access = await resolveAccess(userId);
  if ("error" in access) return access.error;

  const service = createServiceClient();
  const { data, error } = await service
    .from("user_profiles")
    .select("user_id, full_name, signature_html, signature_updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    user_id: userId,
    full_name: data?.full_name ?? null,
    signature_html: data?.signature_html ?? null,
    signature_updated_at: data?.signature_updated_at ?? null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const access = await resolveAccess(userId);
  if ("error" in access) return access.error;

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const signature = parsed.data.signature_html?.trim() ? parsed.data.signature_html : null;
  const updatedAt = signature ? new Date().toISOString() : null;

  const service = createServiceClient();
  const { error } = await service.from("user_profiles").upsert(
    {
      user_id: userId,
      signature_html: signature,
      signature_updated_at: updatedAt,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    signature_html: signature,
    signature_updated_at: updatedAt,
  });
}
