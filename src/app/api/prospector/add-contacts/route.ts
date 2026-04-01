import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ContactInput = {
  person_id: string;
  full_name: string;
  current_job_title: string;
  company_name: string;
  company_domain: string | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
};

type AddContactsRequestBody = {
  contacts: ContactInput[];
  listId: string | null;
  newListName: string | null;
  skipDuplicates: boolean;
  workspaceId: string;
};

type ProspeoEnrichResponse = {
  error: boolean;
  error_code?: string;
  person?: {
    email?: string;
    email_status?: string;
    first_name?: string;
    last_name?: string;
  };
};

function parseName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
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

  if (!process.env.PROSPEO_API_KEY) {
    return NextResponse.json(
      {
        error:
          "Prospeo API key not configured. Add PROSPEO_API_KEY to your environment variables.",
      },
      { status: 500 }
    );
  }

  const body: AddContactsRequestBody = await request.json();
  const {
    contacts,
    listId,
    newListName,
    skipDuplicates = true,
    workspaceId,
  } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  // Verify user has access to this workspace
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let targetListId: string | null = listId;

  // Create new list if requested
  if (newListName && newListName.trim()) {
    const { data: newList, error: listError } = await supabase
      .from("contact_lists")
      .insert({
        workspace_id: workspaceId,
        name: newListName.trim(),
        is_dynamic: false,
      })
      .select("id")
      .single();

    if (listError || !newList) {
      return NextResponse.json(
        { error: "Failed to create list" },
        { status: 500 }
      );
    }
    targetListId = newList.id;
  }

  let added = 0;
  let skipped = 0;
  let suppressed = 0;
  const errors: string[] = [];

  // Process contacts sequentially to be safe with rate limits
  for (const contact of contacts) {
    try {
      // Enrich to get verified email
      const enrichResponse = await fetch("https://api.prospeo.io/enrich-person", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KEY": process.env.PROSPEO_API_KEY,
        },
        body: JSON.stringify({
          only_verified_email: true,
          enrich_mobile: false,
          data: { person_id: contact.person_id },
        }),
      });

      const enrichData: ProspeoEnrichResponse = await enrichResponse.json();

      const email =
        !enrichData.error &&
        enrichData.person?.email_status === "VERIFIED" &&
        enrichData.person?.email
          ? enrichData.person.email
          : null;

      // Check suppressions before inserting
      if (email) {
        const emailDomain = email.split("@")[1]?.toLowerCase();
        const { data: suppression } = await supabase
          .from("suppressions")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .or(`email.eq.${email},domain.eq.${emailDomain}`)
          .limit(1)
          .maybeSingle();

        if (suppression) {
          suppressed++;
          await sleep(100);
          continue;
        }
      }

      // Skip duplicate check (by email) if enabled and email is available
      if (skipDuplicates && email) {
        const { data: existing } = await supabase
          .from("contacts")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("email", email)
          .single();

        if (existing) {
          skipped++;
          await sleep(100);
          continue;
        }
      }

      // Upsert company
      let companyId: string | null = null;
      if (contact.company_name) {
        if (contact.company_domain) {
          // Try to find existing company by domain first
          const { data: existingCompany } = await supabase
            .from("companies")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("domain", contact.company_domain)
            .single();

          if (existingCompany) {
            companyId = existingCompany.id;
          } else {
            const { data: newCompany } = await supabase
              .from("companies")
              .insert({
                workspace_id: workspaceId,
                name: contact.company_name,
                domain: contact.company_domain,
              })
              .select("id")
              .single();
            companyId = newCompany?.id ?? null;
          }
        } else {
          // No domain — just insert
          const { data: newCompany } = await supabase
            .from("companies")
            .insert({
              workspace_id: workspaceId,
              name: contact.company_name,
            })
            .select("id")
            .single();
          companyId = newCompany?.id ?? null;
        }
      }

      // Insert contact
      const { firstName, lastName } = parseName(contact.full_name);

      // email is required by schema — if no verified email, use a placeholder
      const contactEmail = email
        ? email
        : `prospector_noemail_${contact.person_id}@placeholder.invalid`;

      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          workspace_id: workspaceId,
          email: contactEmail,
          first_name: firstName,
          last_name: lastName || null,
          company_id: companyId,
          source: "prospector",
          title: contact.current_job_title || null,
          city: contact.city || null,
          country: contact.country || null,
          linkedin_url: contact.linkedin_url || null,
          email_status: email ? "valid" : "unverified",
        })
        .select("id")
        .single();

      if (contactError || !newContact) {
        errors.push(`Failed to add ${contact.full_name}: ${contactError?.message}`);
        await sleep(100);
        continue;
      }

      // Add to list if applicable
      if (targetListId) {
        await supabase.from("contact_list_members").insert({
          list_id: targetListId,
          contact_id: newContact.id,
        });
      }

      added++;
    } catch (err) {
      errors.push(
        `Error processing ${contact.full_name}: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }

    // Rate limit protection between Prospeo calls
    await sleep(100);
  }

  return NextResponse.json({
    added,
    skipped,
    suppressed,
    errors,
    listId: targetListId,
  });
}
