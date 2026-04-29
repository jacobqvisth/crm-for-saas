import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

type DiscoveredShop = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  country_code: string | null;
  primary_email: string | null;
  all_emails: string[] | null;
  all_phones: string[] | null;
  instagram_url: string | null;
  facebook_url: string | null;
  google_place_id: string | null;
  rating: number | null;
  review_count: number | null;
  category: string | null;
  email_valid: boolean | null;
  email_status: string | null;
  email_verified_at: string | null;
};

const SHOP_FIELDS =
  "id, name, website, domain, phone, address, street, city, postal_code, country, country_code, primary_email, all_emails, all_phones, instagram_url, facebook_url, google_place_id, rating, review_count, category, email_valid, email_status, email_verified_at";
const PAGE_SIZE = 1000;
const INSERT_BATCH = 500;

export async function POST(request: NextRequest) {
  const serverClient = await createServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { shop_ids, select_all, filters } = body as {
    shop_ids?: string[];
    select_all?: boolean;
    filters?: {
      country_code?: string;
      status?: string;
      has_email?: boolean;
      has_phone?: boolean;
      verified_email?: boolean;
      search?: string;
      categories?: string[];
    };
  };

  if (!select_all && (!Array.isArray(shop_ids) || shop_ids.length === 0)) {
    return NextResponse.json({ error: "shop_ids required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: workspace, error: wsError } = await supabase
    .from("workspaces")
    .select("id")
    .limit(1)
    .single();

  if (wsError || !workspace) {
    return NextResponse.json({ error: "Could not resolve workspace" }, { status: 500 });
  }
  const workspaceId = workspace.id;

  // --- 1. Fetch all matching shops (paginated to bypass PostgREST 1000-row cap) ---
  const allShops: DiscoveredShop[] = [];

  if (!select_all) {
    // Explicit IDs — split into chunks to avoid query size limits
    for (let offset = 0; offset < shop_ids!.length; offset += PAGE_SIZE) {
      const chunk = shop_ids!.slice(offset, offset + PAGE_SIZE);
      const { data, error } = await supabase
        .from("discovered_shops")
        .select(SHOP_FIELDS)
        .in("id", chunk);
      if (error) return NextResponse.json({ error: "Failed to fetch shops" }, { status: 500 });
      if (data) allShops.push(...(data as DiscoveredShop[]));
    }
  } else {
    // select_all with filters — paginate through all matching rows
    let offset = 0;
    while (true) {
      let q = supabase.from("discovered_shops").select(SHOP_FIELDS);

      if (filters) {
        const status = filters.status;
        if (status && status !== "all") {
          q = q.in("status", status.split(",").map((s) => s.trim()));
        } else if (!status) {
          q = q.in("status", ["new", "enriched"]);
        }
        if (filters.country_code) q = q.eq("country_code", filters.country_code.toUpperCase());
        if (filters.has_email) q = q.not("primary_email", "is", null).neq("primary_email", "");
        if (filters.has_phone) q = q.not("phone", "is", null).neq("phone", "");
        if (filters.verified_email) q = q.eq("email_status", "valid");
        if (filters.search?.trim()) {
          const s = filters.search.trim();
          q = q.or(`name.ilike.%${s}%,city.ilike.%${s}%,domain.ilike.%${s}%`);
        }
        if (filters.categories && filters.categories.length > 0) {
          q = q.overlaps("all_categories", filters.categories);
        }
      } else {
        q = q.in("status", ["new", "enriched"]);
      }

      const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
      if (error) return NextResponse.json({ error: "Failed to fetch shops" }, { status: 500 });
      if (!data || data.length === 0) break;
      allShops.push(...(data as DiscoveredShop[]));
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  const invalidEmail = allShops.filter((s) => s.email_valid === false);
  const validShops = allShops.filter((s) => s.email_valid !== false);
  const skipped_invalid_email = invalidEmail.length;

  // Mark invalid-email shops as skipped (chunked to avoid URL length limits)
  for (let i = 0; i < invalidEmail.length; i += PAGE_SIZE) {
    const chunk = invalidEmail.slice(i, i + PAGE_SIZE);
    await supabase
      .from("discovered_shops")
      .update({ status: "skipped" })
      .in("id", chunk.map((s) => s.id));
  }

  // --- 2. Pre-fetch all existing companies to build dedup maps ---
  // Domain match is global (a domain identifies one business across countries).
  // Name match is country-scoped (e.g. "AD Baltic" exists separately in EE/LV/LT).
  const domainMap = new Map<string, string>(); // lowercase domain → company id
  const nameByCountry = new Map<string, string>(); // `${country_code}:${lowercase name}` → company id

  let companyOffset = 0;
  while (true) {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("id, domain, name, country_code")
      .eq("workspace_id", workspaceId)
      .range(companyOffset, companyOffset + PAGE_SIZE - 1);
    if (error || !companies || companies.length === 0) break;
    for (const c of companies) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), c.id);
      if (c.name && c.country_code) {
        nameByCountry.set(`${c.country_code.toUpperCase()}:${c.name.toLowerCase()}`, c.id);
      }
    }
    if (companies.length < PAGE_SIZE) break;
    companyOffset += PAGE_SIZE;
  }

  // --- 3. Classify shops in memory ---
  const duplicates: Array<{ shop: DiscoveredShop; companyId: string }> = [];
  const newShops: DiscoveredShop[] = [];

  for (const shop of validShops) {
    const domain = shop.domain ?? (shop.website ? extractDomain(shop.website) : null);
    const nameKey =
      shop.name && shop.country_code
        ? `${shop.country_code.toUpperCase()}:${shop.name.toLowerCase()}`
        : null;
    const existingId =
      (domain && domainMap.get(domain.toLowerCase())) ||
      (nameKey && nameByCountry.get(nameKey));

    if (existingId) {
      duplicates.push({ shop, companyId: existingId });
    } else {
      newShops.push(shop);
    }
  }

  const skipped_duplicates = duplicates.length;

  // Mark duplicates as imported. Bulk upsert with `name` included to satisfy
  // the NOT NULL constraint on discovered_shops.name — PostgREST resolves
  // upsert as INSERT ... ON CONFLICT (id) DO UPDATE, and the INSERT side
  // validates NOT NULL on the proposed row before the conflict path triggers
  // UPDATE. Without `name`, the entire statement is silently rejected.
  for (let i = 0; i < duplicates.length; i += PAGE_SIZE) {
    const chunk = duplicates.slice(i, i + PAGE_SIZE);
    const { error } = await supabase.from("discovered_shops").upsert(
      chunk.map(({ shop, companyId }) => ({
        id: shop.id,
        name: shop.name,
        status: "imported",
        crm_company_id: companyId,
      })),
    );
    if (error) {
      return NextResponse.json(
        { error: `Duplicate marking failed: ${error.message}` },
        { status: 500 },
      );
    }
  }

  let promoted = 0;

  if (newShops.length > 0) {
    // Within-batch domain collision detection. The companies table has a
    // partial UNIQUE index on (workspace_id, domain) WHERE domain IS NOT NULL.
    // Some scraped "domains" are directory listings (e.g. vz.lt, info.lt,
    // auto.lt) shared by dozens of unrelated shops. Inserting them all with
    // the same domain trips the UNIQUE and rolls back the whole batch. For
    // domains that appear more than once in this batch, drop the domain on
    // the duplicates so each shop still becomes a separate company.
    const batchDomainCount = new Map<string, number>();
    const resolvedDomains: (string | null)[] = newShops.map((shop) => {
      const d = shop.domain ?? (shop.website ? extractDomain(shop.website) : null);
      if (d) batchDomainCount.set(d.toLowerCase(), (batchDomainCount.get(d.toLowerCase()) ?? 0) + 1);
      return d;
    });
    // Also exclude domains that already exist in companies (duplicates dedup
    // map will have caught these for *some* of these shops, but only the
    // first-matched one — same-domain shops that fell through still need
    // their domain nulled.)
    const insertableDomains: (string | null)[] = resolvedDomains.map((d) => {
      if (!d) return null;
      const lower = d.toLowerCase();
      if (batchDomainCount.get(lower)! > 1) return null;
      if (domainMap.has(lower)) return null;
      return d;
    });

    // --- 4. Batch-insert companies ---
    const insertedCompanyIds: (string | null)[] = new Array(newShops.length).fill(null);

    for (let i = 0; i < newShops.length; i += INSERT_BATCH) {
      const chunk = newShops.slice(i, i + INSERT_BATCH);
      const { data: inserted, error } = await supabase
        .from("companies")
        .insert(
          chunk.map((shop, j) => ({
            workspace_id: workspaceId,
            name: shop.name,
            website: shop.website ?? null,
            domain: insertableDomains[i + j],
            phone: shop.phone ?? null,
            address: shop.address ?? shop.street ?? null,
            city: shop.city ?? null,
            postal_code: shop.postal_code ?? null,
            country: shop.country ?? null,
            country_code: shop.country_code ?? null,
            instagram_url: shop.instagram_url ?? null,
            facebook_url: shop.facebook_url ?? null,
            google_place_id: shop.google_place_id ?? null,
            rating: shop.rating ?? null,
            review_count: shop.review_count ?? null,
            industry: "Automotive",
            category: shop.category ?? null,
            tags: ["independent"],
          })),
        )
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `Company insert failed: ${error.message}` },
          { status: 500 },
        );
      }
      if (inserted) {
        if (inserted.length !== chunk.length) {
          console.warn(`Company batch: expected ${chunk.length}, got ${inserted.length}`);
        }
        for (let j = 0; j < inserted.length; j++) {
          insertedCompanyIds[i + j] = inserted[j].id;
        }
      }
    }

    // --- 5. Batch-insert contacts (only for shops that got a company ID) ---
    type ContactEntry = { shopIndex: number; companyId: string };
    const contactEntries: ContactEntry[] = [];
    for (let i = 0; i < newShops.length; i++) {
      const companyId = insertedCompanyIds[i];
      if (companyId) contactEntries.push({ shopIndex: i, companyId });
    }

    const insertedContactIds = new Map<number, string>(); // shopIndex → contact id

    for (let i = 0; i < contactEntries.length; i += INSERT_BATCH) {
      const chunk = contactEntries.slice(i, i + INSERT_BATCH);
      const { data: inserted, error } = await supabase
        .from("contacts")
        .insert(
          chunk.map(({ shopIndex, companyId }) => {
            const shop = newShops[shopIndex];
            return {
              workspace_id: workspaceId,
              first_name: null,
              last_name: null,
              email: shop.primary_email ?? "",
              phone: shop.phone ?? null,
              address: shop.address ?? shop.street ?? null,
              city: shop.city ?? null,
              postal_code: shop.postal_code ?? null,
              country: shop.country ?? null,
              country_code: shop.country_code ?? null,
              all_emails: shop.all_emails ?? null,
              all_phones: shop.all_phones ?? null,
              instagram_url: shop.instagram_url ?? null,
              facebook_url: shop.facebook_url ?? null,
              company_id: companyId,
              is_primary: true,
              source: "discovery",
              language: deriveLanguage(shop.country_code),
              email_status: shop.email_status ?? "unknown",
              email_verified_at: shop.email_verified_at ?? null,
              lead_status: "new",
              status: "active",
              tags: ["owner"],
            };
          })
        )
        .select("id");

      if (error) {
        return NextResponse.json(
          { error: `Contact insert failed: ${error.message}` },
          { status: 500 },
        );
      }
      if (inserted) {
        if (inserted.length !== chunk.length) {
          console.warn(`Contact batch: expected ${chunk.length}, got ${inserted.length}`);
        }
        for (let j = 0; j < inserted.length; j++) {
          insertedContactIds.set(chunk[j].shopIndex, inserted[j].id);
        }
      }
    }

    // --- 6. Bulk-update discovered_shops for newly promoted rows. Same
    // upsert-with-name pattern as duplicate marking above. ---
    const shopUpdates = newShops
      .map((shop, i) => {
        const companyId = insertedCompanyIds[i];
        if (!companyId) return null;
        promoted++;
        return {
          id: shop.id,
          name: shop.name,
          status: "imported",
          crm_company_id: companyId,
          crm_contact_id: insertedContactIds.get(i) ?? null,
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    for (let i = 0; i < shopUpdates.length; i += PAGE_SIZE) {
      const chunk = shopUpdates.slice(i, i + PAGE_SIZE);
      const { error } = await supabase.from("discovered_shops").upsert(chunk);
      if (error) {
        return NextResponse.json(
          { error: `Shop status update failed: ${error.message}` },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ promoted, skipped_duplicates, skipped_invalid_email });
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function deriveLanguage(countryCode: string | null): string | null {
  const map: Record<string, string> = {
    EE: "et",
    SE: "sv",
    FI: "fi",
    LV: "lv",
    LT: "lt",
    NO: "no",
    DK: "da",
  };
  return countryCode ? (map[countryCode] ?? null) : null;
}
