import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

type DiscoveredShop = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  primary_email: string | null;
  google_place_id: string | null;
};

export async function POST(request: NextRequest) {
  // Auth guard
  const serverClient = await createServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { shop_ids } = body as { shop_ids: string[] };

  if (!Array.isArray(shop_ids) || shop_ids.length === 0) {
    return NextResponse.json({ error: "shop_ids required" }, { status: 400 });
  }

  // Service role client for writes (discovered_shops has no RLS, companies/contacts do)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get the workspace ID (single-workspace app)
  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id")
    .limit(1)
    .single();

  if (wsError || !workspace) {
    return NextResponse.json({ error: "Could not resolve workspace" }, { status: 500 });
  }
  const workspaceId = workspace.id;

  // Fetch shops
  const { data: shops, error: fetchError } = await supabase
    .from("discovered_shops")
    .select(
      "id, name, website, domain, phone, city, country, country_code, primary_email, google_place_id"
    )
    .in("id", shop_ids);

  if (fetchError || !shops) {
    return NextResponse.json({ error: "Failed to fetch shops" }, { status: 500 });
  }

  let promoted = 0;
  let skipped_duplicates = 0;

  for (const shop of shops as DiscoveredShop[]) {
    // Check for duplicate company by domain or name
    let companyId: string | null = null;
    let isDuplicate = false;

    if (shop.domain) {
      const { data: existingByDomain } = await supabase
        .from("companies")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("domain", shop.domain)
        .maybeSingle();

      if (existingByDomain) {
        isDuplicate = true;
        companyId = existingByDomain.id;
      }
    }

    if (!isDuplicate && shop.name) {
      const { data: existingByName } = await supabase
        .from("companies")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", shop.name)
        .maybeSingle();

      if (existingByName) {
        isDuplicate = true;
        companyId = existingByName.id;
      }
    }

    if (isDuplicate) {
      skipped_duplicates++;
      // Still mark as imported so it doesn't keep showing up
      await supabase
        .from("discovered_shops")
        .update({
          status: "imported",
          crm_company_id: companyId,
        })
        .eq("id", shop.id);
      continue;
    }

    // Insert company
    const websiteDomain = shop.domain ?? (shop.website ? extractDomain(shop.website) : null);
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({
        workspace_id: workspaceId,
        name: shop.name,
        website: shop.website ?? null,
        domain: websiteDomain,
        phone: shop.phone ?? null,
        city: shop.city ?? null,
        country: shop.country ?? null,
      })
      .select("id")
      .single();

    if (companyError || !newCompany) {
      // Skip this shop on error
      continue;
    }
    companyId = newCompany.id;

    // Insert placeholder contact
    const contactEmail = shop.primary_email
      ? shop.primary_email
      : `discovery_noemail_${shop.id}@placeholder.invalid`;

    const { data: newContact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        first_name: "Owner",
        last_name: shop.name,
        email: contactEmail,
        phone: shop.phone ?? null,
        company_id: companyId,
        source: "discovery",
        city: shop.city ?? null,
        country: shop.country ?? null,
        email_status: shop.primary_email ? "valid" : "unverified",
      })
      .select("id")
      .single();

    if (contactError || !newContact) {
      // Still mark company imported even if contact failed
      await supabase
        .from("discovered_shops")
        .update({ status: "imported", crm_company_id: companyId })
        .eq("id", shop.id);
      continue;
    }

    // Mark shop as imported
    await supabase
      .from("discovered_shops")
      .update({
        status: "imported",
        crm_company_id: companyId,
        crm_contact_id: newContact.id,
      })
      .eq("id", shop.id);

    promoted++;
  }

  return NextResponse.json({ promoted, skipped_duplicates });
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
