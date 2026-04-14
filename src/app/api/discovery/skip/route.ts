import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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
      categories?: string[]; // included categories (null/absent = all)
    };
  };

  if (!select_all && (!Array.isArray(shop_ids) || shop_ids.length === 0)) {
    return NextResponse.json({ error: "shop_ids required" }, { status: 400 });
  }

  // Service role client for writes
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (select_all && filters) {
    // Fetch all matching IDs using the same filter logic as /api/discovery/shops
    let idQuery = supabase.from("discovered_shops").select("id");
    const status = filters.status;
    if (status && status !== "all") {
      idQuery = idQuery.in("status", status.split(",").map((s) => s.trim()));
    } else if (!status) {
      idQuery = idQuery.in("status", ["new", "enriched"]);
    }
    if (filters.country_code) idQuery = idQuery.eq("country_code", filters.country_code.toUpperCase());
    if (filters.has_email) idQuery = idQuery.not("primary_email", "is", null).neq("primary_email", "");
    if (filters.has_phone) idQuery = idQuery.not("phone", "is", null).neq("phone", "");
    if (filters.verified_email) idQuery = idQuery.eq("email_valid", true);
    if (filters.search?.trim()) {
      const s = filters.search.trim();
      idQuery = idQuery.or(`name.ilike.%${s}%,city.ilike.%${s}%,domain.ilike.%${s}%`);
    }
    if (filters.categories && filters.categories.length > 0) {
      idQuery = idQuery.overlaps("all_categories", filters.categories);
    }

    const { data: matchingRows, error: idError } = await idQuery;
    if (idError) {
      return NextResponse.json({ error: idError.message }, { status: 500 });
    }
    const ids = (matchingRows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ skipped: 0 });
    }

    const { error: updateError } = await supabase
      .from("discovered_shops")
      .update({ status: "skipped" })
      .in("id", ids);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ skipped: ids.length });
  }

  const { error } = await supabase
    .from("discovered_shops")
    .update({ status: "skipped" })
    .in("id", shop_ids!);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ skipped: shop_ids!.length });
}
