// Hourly Vercel cron (see vercel.json). Continuous list → sequence enrollment.
//
// For every enabled sequence_auto_enrollments link: resolve the list (dynamic
// lists re-run their stored filters, so the cohort rolls forward on its own),
// apply the list's stored exclusions, and enroll members via enrollContacts()
// — which already skips anyone ever enrolled in the sequence, so each run
// only picks up newcomers and re-running is safe.
//
// With unenroll_when_left_list, active enrollments whose contact no longer
// matches the list (e.g. a free user who upgraded to paid) are completed and
// their queued emails cancelled — the sequence's allow_customers bypass means
// the send-time customer guard won't stop them, so this is the exit rule.
//
// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of /api/cron/*.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enrollContacts } from "@/lib/sequences/enrollment";
import { resolveListContactIds, type ResolvableList } from "@/lib/lists/filter-query";
import { parseListExclusions, resolveExcludedContactIds } from "@/lib/lists/exclusions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENROLL_BATCH = 200;
const CHUNK_IN = 200;

function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const explicit = request.headers.get("x-sync-secret");
  const provided = bearer || explicit;
  if (!syncSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

type LinkResult = {
  link_id: string;
  sequence_id: string;
  list_id: string;
  resolved: number;
  excluded: number;
  enrolled: number;
  skipped: number;
  unenrolled: number;
  error?: string;
};

async function processLink(
  supabase: ReturnType<typeof createServiceClient>,
  link: {
    id: string;
    workspace_id: string;
    sequence_id: string;
    list_id: string;
    allow_customers: boolean;
    unenroll_when_left_list: boolean;
    sender_account_id: string | null;
  },
): Promise<LinkResult> {
  const result: LinkResult = {
    link_id: link.id,
    sequence_id: link.sequence_id,
    list_id: link.list_id,
    resolved: 0,
    excluded: 0,
    enrolled: 0,
    skipped: 0,
    unenrolled: 0,
  };

  const { data: list, error: listErr } = await supabase
    .from("contact_lists")
    .select("id, workspace_id, is_dynamic, filters, exclusions")
    .eq("id", link.list_id)
    .maybeSingle();
  if (listErr || !list) {
    result.error = listErr?.message ?? "List not found";
    return result;
  }

  const resolvedIds = await resolveListContactIds(supabase, list as ResolvableList);
  result.resolved = resolvedIds.length;

  const exclusions = parseListExclusions(list.exclusions);
  const excluded = await resolveExcludedContactIds(
    supabase,
    list.workspace_id,
    exclusions,
    { excludeSelfListId: list.id },
  );
  const memberIds =
    excluded.size > 0 ? resolvedIds.filter((id) => !excluded.has(id)) : resolvedIds;
  result.excluded = resolvedIds.length - memberIds.length;

  // enrollContacts dedups against every prior enrollment in the sequence, so
  // passing the full membership each run is correct — only newcomers enroll.
  for (let i = 0; i < memberIds.length; i += ENROLL_BATCH) {
    const batch = memberIds.slice(i, i + ENROLL_BATCH);
    const r = await enrollContacts(
      {
        sequenceId: link.sequence_id,
        contactIds: batch,
        workspaceId: link.workspace_id,
        senderAccountId: link.sender_account_id ?? undefined,
        allowCustomers: link.allow_customers,
      },
      supabase,
    );
    result.enrolled += r.enrolled;
    result.skipped += r.skipped;
  }

  if (link.unenroll_when_left_list) {
    result.unenrolled = await unenrollDepartedContacts(
      supabase,
      link.sequence_id,
      new Set(memberIds),
    );
  }

  return result;
}

// Complete active enrollments whose contact has left the list and cancel
// their queued emails. Mirrors the pause action in
// /api/sequences/enrollments/[id] (cancel queue rows first would race the
// send cron, so flip the enrollment status first — the cron checks it).
async function unenrollDepartedContacts(
  supabase: ReturnType<typeof createServiceClient>,
  sequenceId: string,
  currentMemberIds: Set<string>,
): Promise<number> {
  const PAGE = 1000;
  const departed: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("sequence_enrollments")
      .select("id, contact_id")
      .eq("sequence_id", sequenceId)
      .eq("status", "active")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    departed.push(
      ...page.filter((e) => !currentMemberIds.has(e.contact_id)).map((e) => e.id),
    );
    if (page.length < PAGE) break;
  }

  for (let i = 0; i < departed.length; i += CHUNK_IN) {
    const chunk = departed.slice(i, i + CHUNK_IN);
    const { error: updErr } = await supabase
      .from("sequence_enrollments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .in("id", chunk);
    if (updErr) throw updErr;
    const { error: queueErr } = await supabase
      .from("email_queue")
      .update({ status: "cancelled" })
      .in("enrollment_id", chunk)
      .in("status", ["scheduled", "pending"]);
    if (queueErr) throw queueErr;
  }

  return departed.length;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: links, error: linksErr } = await supabase
    .from("sequence_auto_enrollments")
    .select(
      "id, workspace_id, sequence_id, list_id, allow_customers, unenroll_when_left_list, sender_account_id",
    )
    .eq("enabled", true);
  if (linksErr) {
    return NextResponse.json({ error: linksErr.message }, { status: 500 });
  }

  const results: LinkResult[] = [];
  for (const link of links ?? []) {
    let result: LinkResult;
    try {
      result = await processLink(supabase, link);
    } catch (e) {
      result = {
        link_id: link.id,
        sequence_id: link.sequence_id,
        list_id: link.list_id,
        resolved: 0,
        excluded: 0,
        enrolled: 0,
        skipped: 0,
        unenrolled: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    results.push(result);

    const { error: stampErr } = await supabase
      .from("sequence_auto_enrollments")
      .update({
        last_run_at: new Date().toISOString(),
        last_result: result,
      })
      .eq("id", link.id);
    if (stampErr) {
      console.error("[auto-enroll] failed to stamp last_run", stampErr);
    }
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json(
    { ok: failed.length === 0, links: results.length, results },
    { status: failed.length === 0 ? 200 : 500 },
  );
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
