import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { getPlaybook, BOUNCED_SUB_STATUSES } from "@/lib/calls/playbooks";

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

const Body = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("playbook"),
    playbookKey: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
  }),
  z.object({
    type: z.literal("today"),
    contactIds: z.array(z.string().uuid()).min(1).max(500),
    name: z.string().min(1).max(120).optional(),
  }),
]);

// POST /api/calls/planner/create-list — turn a planner segment into a calling
// list and return its id so the client can route to the worklist.
//  - playbook (dynamic filters): rolls forward daily as a dynamic list.
//  - playbook "payment_bounced" or "today": a static snapshot of the contacts
//    that match right now (membership stored in contact_list_members).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspaceId = await getWorkspaceId(supabase, user.id);
  if (!workspaceId) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Resolve the list's name, dynamic-ness, filters, and (if static) members.
  let name: string;
  let description: string | null = null;
  let isDynamic = false;
  let filters: Json | null = null;
  let staticIds: string[] = [];

  if (body.type === "playbook") {
    const pb = getPlaybook(body.playbookKey);
    if (!pb) return NextResponse.json({ error: "Unknown playbook" }, { status: 400 });
    name = body.name?.trim() || pb.listName;
    description = pb.hint;

    if (pb.special === "payment_bounced") {
      // Snapshot: resolve the bounced-payment contacts right now.
      const { data: subs } = await supabase
        .from("dashboard_subscriptions")
        .select("stripe_customer_id")
        .in("status", BOUNCED_SUB_STATUSES);
      const custIds = [
        ...new Set((subs ?? []).map((s) => s.stripe_customer_id).filter((id): id is string => !!id)),
      ];
      if (custIds.length > 0) {
        const { data: matched, error } = await supabase
          .from("contacts")
          .select("id")
          .eq("workspace_id", workspaceId)
          .in("user_stripe_customer_id", custIds);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        staticIds = (matched ?? []).map((c) => c.id);
      }
    } else {
      isDynamic = true;
      filters = (pb.filters ?? []) as unknown as Json;
    }
  } else {
    // body.type === "today"
    name = body.name?.trim() || `Top calls — ${stockholmDate()}`;
    description = "Today's highest-relevance contacts from the Call Planner.";
    staticIds = [...new Set(body.contactIds)];
  }

  // Create the calling list.
  const { data: list, error: listErr } = await supabase
    .from("contact_lists")
    .insert({
      workspace_id: workspaceId,
      name,
      description,
      is_dynamic: isDynamic,
      filters,
      purpose: "calling",
    })
    .select("id, name, is_dynamic")
    .single();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });

  // Attach static members if any.
  if (!isDynamic && staticIds.length > 0) {
    const rows = staticIds.map((contactId) => ({ list_id: list.id, contact_id: contactId }));
    const { error: memErr } = await supabase
      .from("contact_list_members")
      .upsert(rows, { onConflict: "list_id,contact_id" });
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { list, memberCount: isDynamic ? null : staticIds.length },
    { status: 201 },
  );
}

function stockholmDate(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    day: "2-digit",
    month: "short",
  }).format(new Date());
}
