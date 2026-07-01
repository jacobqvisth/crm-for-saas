import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveListContactIds, type ResolvableList } from "@/lib/lists/filter-query";
import { parseListExclusions, resolveExcludedContactIds } from "@/lib/lists/exclusions";

// GET /api/lists/[id]/resolve — resolve a list's contact ids with its stored
// exclusions applied. Client modals (email enrollment, campaign launch) can't
// resolve exclusions themselves because the internal_testers source needs a
// service-role client to read the global dashboard_* tables. So they call this
// server endpoint instead of resolving in the browser.
//
// This applies ONLY the list's own stored exclusions — the always-on never-call
// rule is a calling-surface concern (see the calls worklist), not something the
// email path should force.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: listId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: list, error: listErr } = await supabase
    .from("contact_lists")
    .select("id, workspace_id, is_dynamic, filters, exclusions")
    .eq("id", listId)
    .maybeSingle();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", list.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let resolvedIds: string[];
  try {
    resolvedIds = await resolveListContactIds(supabase, list as ResolvableList);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to resolve list" },
      { status: 500 },
    );
  }

  const exclusions = parseListExclusions(list.exclusions);
  const excluded = await resolveExcludedContactIds(supabase, list.workspace_id, exclusions, {
    excludeSelfListId: list.id,
  });
  const contactIds =
    excluded.size > 0 ? resolvedIds.filter((id) => !excluded.has(id)) : resolvedIds;

  return NextResponse.json({
    contactIds,
    total: contactIds.length,
    resolvedTotal: resolvedIds.length,
    excludedCount: resolvedIds.length - contactIds.length,
  });
}
