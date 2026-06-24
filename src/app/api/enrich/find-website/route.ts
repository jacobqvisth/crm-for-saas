import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findWebsite } from "@/lib/enrich/find-website";

// Web search + liveness verification + retries on dead domains can take a while.
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, contactId, companyId } = body as {
    workspaceId: string;
    contactId?: string;
    companyId?: string;
  };

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!contactId && !companyId) {
    return NextResponse.json({ error: "Missing contactId or companyId" }, { status: 400 });
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

  let name: string | null = null;
  let email: string | null = null;
  let extraEmails: string[] | null = null;
  let city: string | null = null;
  let country: string | null = null;

  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("first_name, last_name, email, all_emails, city, country, company_id")
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null;
    email = contact.email;
    extraEmails = contact.all_emails;
    city = contact.city;
    country = contact.country;

    // A person's name alone is rarely searchable — borrow the company name &
    // location so the search has a real business to find.
    if (contact.company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("name, city, country")
        .eq("id", contact.company_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (company) {
        if (company.name) name = name ? `${name} (${company.name})` : company.name;
        city = city || company.city;
        country = country || company.country;
      }
    }
  } else if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name, city, country")
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    name = company.name;
    city = company.city;
    country = company.country;
  }

  const result = await findWebsite({ name, email, extraEmails, city, country });
  return NextResponse.json(result);
}
