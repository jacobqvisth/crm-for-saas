import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/ceo/env";
import {
  listInternalTestPatterns,
  searchDashboardUsers,
  searchDashboardWorkshops,
} from "@/lib/ceo/internal-test/loader";
import {
  addPatternAction,
  removePatternAction,
  setUserExemptAction,
  setUserInternalAction,
  setWorkshopInternalAction,
} from "@/app/(dashboard)/dashboard/settings/actions";

// Read/mutate the dashboard internal-test exclusion sets from the
// /settings/exclusions page. The underlying data is GLOBAL (dashboard_* tables
// via the service client), so this is gated the same way /dashboard/* is:
// the CEO_ALLOWED_EMAILS allow-list — NOT just "any authenticated user",
// because Google sign-in auto-onboards any domain into its own workspace.
// Mutations delegate to the same server actions the /dashboard/settings
// editor uses, so flag semantics and cache busting stay in one place.

async function requireAllowedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isAllowedEmail(user.email)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const gate = await requireAllowedUser();
  if ("error" in gate) return gate.error;

  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") ?? "users";
  const q = (params.get("q") ?? "").trim();

  try {
    if (kind === "users") {
      return NextResponse.json({ users: await searchDashboardUsers(q) });
    }
    if (kind === "workshops") {
      return NextResponse.json({ workshops: await searchDashboardWorkshops(q) });
    }
    if (kind === "patterns") {
      return NextResponse.json({ patterns: await listInternalTestPatterns() });
    }
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 },
    );
  }
}

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_user_internal"),
    userId: z.string().min(1),
    isInternal: z.boolean(),
  }),
  z.object({
    action: z.literal("set_user_exempt"),
    userId: z.string().min(1),
    isExempt: z.boolean(),
  }),
  z.object({
    action: z.literal("set_workshop_internal"),
    workshopId: z.string().min(1),
    isInternal: z.boolean(),
  }),
  z.object({
    action: z.literal("add_pattern"),
    kind: z.enum(["email", "username"]),
    value: z.string().min(1).max(254),
  }),
  z.object({
    action: z.literal("remove_pattern"),
    id: z.string().uuid(),
  }),
]);

export async function POST(request: NextRequest) {
  const gate = await requireAllowedUser();
  if ("error" in gate) return gate.error;

  const parsed = PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const body = parsed.data;
  const fd = new FormData();
  try {
    switch (body.action) {
      case "set_user_internal":
        fd.set("userId", body.userId);
        fd.set("isInternal", body.isInternal ? "true" : "false");
        await setUserInternalAction(fd);
        break;
      case "set_user_exempt":
        fd.set("userId", body.userId);
        fd.set("isExempt", body.isExempt ? "true" : "false");
        await setUserExemptAction(fd);
        break;
      case "set_workshop_internal":
        fd.set("workshopId", body.workshopId);
        fd.set("isInternal", body.isInternal ? "true" : "false");
        await setWorkshopInternalAction(fd);
        break;
      case "add_pattern":
        fd.set("kind", body.kind);
        fd.set("value", body.value);
        await addPatternAction(fd);
        break;
      case "remove_pattern":
        fd.set("id", body.id);
        await removePatternAction(fd);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update" },
      { status: 500 },
    );
  }
}
