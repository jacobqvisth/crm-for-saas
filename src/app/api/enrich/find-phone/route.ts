import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPhones } from "@/lib/enrich/find-phone";

// Website scraping + web search can take a while.
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
  let companyName: string | null = null;
  const websites: (string | null | undefined)[] = [];
  let city: string | null = null;
  let country: string | null = null;
  let countryCode: string | null = null;
  const existing: (string | null | undefined)[] = [];

  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "first_name, last_name, phone, all_phones, website, city, country, country_code, company_id",
      )
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null;
    websites.push(contact.website);
    city = contact.city;
    country = contact.country;
    countryCode = contact.country_code;
    existing.push(contact.phone, ...((contact.all_phones as string[] | null) ?? []));

    // Borrow the company name + website + location so the search can resolve.
    if (contact.company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("name, website, phone, city, country, country_code")
        .eq("id", contact.company_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (company) {
        companyName = company.name;
        websites.push(company.website);
        city = city || company.city;
        country = country || company.country;
        countryCode = countryCode || company.country_code;
        existing.push(company.phone);
      }
    }
  } else if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name, website, phone, city, country, country_code")
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    name = company.name;
    companyName = company.name;
    websites.push(company.website);
    city = company.city;
    country = company.country;
    countryCode = company.country_code;
    existing.push(company.phone);
  }

  const result = await findPhones({
    name,
    companyName,
    websites,
    city,
    country,
    countryCode,
    existing,
  });
  return NextResponse.json(result);
}
