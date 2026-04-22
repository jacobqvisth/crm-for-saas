import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveContactIdsByFilters, type ContactFilters } from "@/lib/contacts-filter";

function mapMVStatus(result: string, subresult: string): string {
  if (subresult === "catchall") return "catch_all";
  switch (result) {
    case "ok":
      return "valid";
    case "error":
      return "invalid";
    case "unknown":
      return "risky";
    default:
      return "unknown";
  }
}

function shouldSkip(
  emailStatus: string,
  emailVerifiedAt: string | null
): boolean {
  if (!emailVerifiedAt) return false;
  const verifiedDate = new Date(emailVerifiedAt);
  const now = new Date();
  const diffDays =
    (now.getTime() - verifiedDate.getTime()) / (1000 * 60 * 60 * 24);

  if (emailStatus === "valid" && diffDays < 90) return true;
  if (emailStatus === "invalid" && diffDays < 30) return true;
  if (emailStatus === "risky" && diffDays < 7) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { contactIds, filters, workspaceId } = body as {
    contactIds?: string[];
    filters?: ContactFilters;
    workspaceId: string;
  };

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
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

  // Resolve IDs — either explicit list or filter expansion
  let allIds: string[];
  if (filters) {
    allIds = await resolveContactIdsByFilters(supabase, workspaceId, filters);
  } else if (Array.isArray(contactIds) && contactIds.length > 0) {
    allIds = contactIds;
  } else {
    return NextResponse.json(
      { error: "Missing contactIds or filters" },
      { status: 400 }
    );
  }

  const totalRequested = allIds.length;

  // Cap at 50
  const idsToProcess = allIds.slice(0, 50);
  const capped = allIds.length > 50;

  // Fetch contacts
  const { data: contacts, error: fetchError } = await supabase
    .from("contacts")
    .select("id, email, email_status, email_verified_at")
    .in("id", idsToProcess)
    .eq("workspace_id", workspaceId);

  if (fetchError || !contacts) {
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }

  let verified = 0;
  let skipped = 0;
  let errors = 0;
  const results: Array<{ id: string; email: string; status: string }> = [];

  const mvKey = process.env.MILLIONVERIFIER_API_KEY;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Skip placeholder emails
    if (contact.email.includes("@placeholder.invalid")) {
      skipped++;
      continue;
    }

    // Apply cache rules
    if (shouldSkip(contact.email_status || "", contact.email_verified_at)) {
      skipped++;
      results.push({
        id: contact.id,
        email: contact.email,
        status: contact.email_status || "unknown",
      });
      continue;
    }

    // Add delay between calls (except for first)
    if (i > 0) {
      await sleep(200);
    }

    try {
      const mvUrl = `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(contact.email)}`;
      const mvRes = await fetch(mvUrl);
      const mvData = await mvRes.json();

      if (!mvRes.ok || mvData.error) {
        errors++;
        continue;
      }

      const mappedStatus = mapMVStatus(
        mvData.result || "",
        mvData.subresult || ""
      );
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("contacts")
        .update({
          email_status: mappedStatus,
          email_verified_at: now,
        })
        .eq("id", contact.id)
        .eq("workspace_id", workspaceId);

      if (updateError) {
        errors++;
        continue;
      }

      verified++;
      results.push({ id: contact.id, email: contact.email, status: mappedStatus });
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    verified,
    skipped,
    errors,
    capped,
    processedCount: idsToProcess.length,
    totalRequested,
    results,
  });
}
