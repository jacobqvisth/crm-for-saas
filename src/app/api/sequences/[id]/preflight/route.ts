import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildFilterQuery } from "@/lib/lists/filter-query";
import type { ListFilter } from "@/lib/lists/filter-query";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sequenceId } = await params;
  const { searchParams } = new URL(request.url);
  const listId = searchParams.get("listId");
  const workspaceId = searchParams.get("workspaceId");

  if (!listId || !workspaceId) {
    return NextResponse.json({ error: "Missing listId or workspaceId" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify workspace membership
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Check for active Gmail accounts (all of them for capacity info)
  const { data: gmailAccounts } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, display_name, daily_sends_count, max_daily_sends, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("daily_sends_count", { ascending: true });

  const gmailAccount = gmailAccounts?.[0]
    ? {
        email: gmailAccounts[0].email_address,
        maxDailySends: gmailAccounts[0].max_daily_sends,
      }
    : null;

  // 2. Check sequence has email steps
  const { count: emailStepCount } = await supabase
    .from("sequence_steps")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .eq("type", "email");

  // 3. Get list metadata, then resolve contacts (dynamic or static)
  const { data: listData } = await supabase
    .from("contact_lists")
    .select("is_dynamic, filters")
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .single();

  type ContactRow = { id: string; email: string | null; first_name: string | null };
  let rawContacts: ContactRow[] = [];

  if (listData?.is_dynamic === true) {
    const filters = (listData.filters as ListFilter[] | null) ?? [];
    const { data: contactData } = await buildFilterQuery(
      supabase,
      workspaceId,
      filters,
      "id, email, first_name",
    );
    rawContacts = (contactData ?? []) as ContactRow[];
  } else {
    const { data: memberData } = await supabase
      .from("contact_list_members")
      .select("contact_id, contacts(id, email, first_name)")
      .eq("list_id", listId);
    rawContacts = ((memberData ?? []) as { contacts: ContactRow | null }[])
      .map((m) => m.contacts)
      .filter((c): c is ContactRow => c !== null);
  }

  const listMemberCount = rawContacts.length;
  let missingEmail = 0;
  let missingFirstName = 0;
  const validContactIds: string[] = [];

  for (const contact of rawContacts) {
    if (!contact.email) {
      missingEmail++;
    } else {
      validContactIds.push(contact.id);
      if (!contact.first_name) {
        missingFirstName++;
      }
    }
  }

  // 4. Count already actively enrolled contacts
  let alreadyEnrolled = 0;
  if (validContactIds.length > 0) {
    const { count } = await supabase
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", sequenceId)
      .eq("status", "active")
      .in("contact_id", validContactIds);
    alreadyEnrolled = count || 0;
  }

  // 5. Count suppressed contacts (email or domain level) and email status counts
  let suppressedCount = 0;
  let invalidEmailCount = 0;
  let unverifiedEmailCount = 0;

  if (validContactIds.length > 0) {
    const { data: contactEmails } = await supabase
      .from("contacts")
      .select("id, email, email_status")
      .in("id", validContactIds);

    if (contactEmails && contactEmails.length > 0) {
      const emails = contactEmails.map((c) => c.email).filter(Boolean) as string[];
      const domains = [
        ...new Set(
          emails
            .map((e) => e.split("@")[1]?.toLowerCase())
            .filter(Boolean) as string[]
        ),
      ];

      const { count: emailSuppressions } = await supabase
        .from("suppressions")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .in("email", emails);

      let domainSuppressions = 0;
      if (domains.length > 0) {
        const { count: dc } = await supabase
          .from("suppressions")
          .select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .in("domain", domains);
        domainSuppressions = dc || 0;
      }

      suppressedCount = (emailSuppressions || 0) + domainSuppressions;
      invalidEmailCount = contactEmails.filter((c) => c.email_status === "invalid").length;
      unverifiedEmailCount = contactEmails.filter(
        (c) => c.email_status === "unknown" || c.email_status === "unverified"
      ).length;
    }
  }

  const enrollableCount = Math.max(0, validContactIds.length - alreadyEnrolled);

  // 6. Token fallback warnings — scan email step content for {{tokens}}
  const { data: emailSteps } = await supabase
    .from("sequence_steps")
    .select("subject_override, body_override")
    .eq("sequence_id", sequenceId)
    .eq("type", "email");

  function extractTokens(
    steps: { subject_override: string | null; body_override: string | null }[]
  ): Set<string> {
    const tokens = new Set<string>();
    const pattern = /\{\{(\w+)\}\}/g;
    for (const step of steps) {
      const text = `${step.subject_override || ""} ${step.body_override || ""}`;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        tokens.add(match[1]);
      }
    }
    return tokens;
  }

  const TOKEN_TO_FIELD: Record<string, string> = {
    first_name: "first_name",
    last_name: "last_name",
    company_name: "company_id",
    phone: "phone",
    title: "title",
    city: "city",
    country: "country",
  };

  const usedTokens = extractTokens(emailSteps || []);
  const checkableTokens = [...usedTokens].filter((t) => TOKEN_TO_FIELD[t]);

  let tokenFallbackCount = 0;

  if (checkableTokens.length > 0 && validContactIds.length > 0) {
    const fields = [...new Set(checkableTokens.map((t) => TOKEN_TO_FIELD[t]))];
    const { data: contactData } = await supabase
      .from("contacts")
      .select(fields.join(", "))
      .in("id", validContactIds);

    if (contactData) {
      const missingAny = contactData.filter((c) =>
        checkableTokens.some((token) => {
          const field = TOKEN_TO_FIELD[token];
          return !c[field as keyof typeof c];
        })
      );
      tokenFallbackCount = missingAny.length;
    }
  }

  const senderAccounts = (gmailAccounts || []).map((a) => ({
    id: a.id,
    email_address: a.email_address,
    display_name: a.display_name,
    daily_sends_count: a.daily_sends_count,
    max_daily_sends: a.max_daily_sends,
    remaining_capacity: Math.max(0, a.max_daily_sends - a.daily_sends_count),
    status: a.status,
  }));

  const totalDailyCapacity = senderAccounts.reduce((sum, a) => sum + a.remaining_capacity, 0);
  const estimatedDaysToSend =
    totalDailyCapacity > 0 ? Math.ceil(enrollableCount / totalDailyCapacity) : null;

  return NextResponse.json({
    gmailConnected: !!gmailAccount,
    gmailAccount,
    hasEmailStep: (emailStepCount || 0) > 0,
    listMemberCount,
    missingEmail,
    missingFirstName,
    alreadyEnrolled,
    enrollableCount,
    suppressedCount,
    invalidEmailCount,
    unverifiedEmailCount,
    tokenFallbackCount,
    senderAccounts,
    totalDailyCapacity,
    estimatedDaysToSend,
  });
}
