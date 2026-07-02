import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPhonesForRecord, saveFoundPhones } from "@/lib/enrich/find-phone-for-contact";

// Each contact does website-discovery + scrape + web search, so we cap the batch
// size and let the client chunk a longer list across several requests.
export const maxDuration = 180;

// Web search is slow (~10-30s each); run a few at a time and keep the batch small
// so we finish comfortably inside maxDuration.
const MAX_BATCH = 6;
const CONCURRENCY = 3;

type ItemResult = {
  contactId: string;
  found: number;
  saved: number;
  websiteAdded: string | null;
  reasoning: string | null;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, contactIds } = body as {
    workspaceId: string;
    contactIds?: string[];
  };

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "Missing contactIds" }, { status: 400 });
  }

  // Workspace membership check
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = Array.from(new Set(contactIds)).slice(0, MAX_BATCH);

  const runOne = async (contactId: string): Promise<ItemResult> => {
    try {
      const result = await findPhonesForRecord(supabase, { workspaceId, contactId });
      const saved = result.phones.length
        ? await saveFoundPhones(supabase, {
            workspaceId,
            contactId,
            // Save into the shared company pool when the contact has a company,
            // matching the PhoneNumbersPanel ownership model.
            companyId: result.companyId,
            countryCode: result.countryCode,
            phones: result.phones,
          })
        : 0;
      return {
        contactId,
        found: result.phones.length,
        saved,
        websiteAdded: result.websiteAdded,
        reasoning: result.reasoning,
      };
    } catch (err) {
      return {
        contactId,
        found: 0,
        saved: 0,
        websiteAdded: null,
        reasoning: err instanceof Error ? err.message : "Failed",
      };
    }
  };

  // Simple concurrency-limited pool.
  const results: ItemResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
    while (cursor < ids.length) {
      const i = cursor++;
      results.push(await runOne(ids[i]));
    }
  });
  await Promise.all(workers);

  const savedTotal = results.reduce((n, r) => n + r.saved, 0);
  const withNumbers = results.filter((r) => r.saved > 0).length;
  return NextResponse.json({
    processed: results.length,
    withNumbers,
    savedTotal,
    results,
  });
}
