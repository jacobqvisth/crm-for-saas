import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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
  emailStatus: string | null,
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

type DiscoveryFilters = {
  country_code?: string;
  status?: string;
  has_email?: boolean;
  has_phone?: boolean;
  verified_email?: boolean;
  search?: string;
  categories?: string[];
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
  const { shopIds, filters } = body as {
    shopIds?: string[];
    filters?: DiscoveryFilters;
  };

  if (!shopIds && !filters) {
    return NextResponse.json(
      { error: "shopIds or filters required" },
      { status: 400 }
    );
  }

  // Service role client — discovered_shops has no RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Resolve shop IDs
  let allIds: string[];
  if (filters) {
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
    if (filters.verified_email) idQuery = idQuery.eq("email_status", "valid");
    if (filters.search?.trim()) {
      const s = filters.search.trim();
      idQuery = idQuery.or(`name.ilike.%${s}%,city.ilike.%${s}%,domain.ilike.%${s}%`);
    }
    if (filters.categories && filters.categories.length > 0) {
      idQuery = idQuery.overlaps("all_categories", filters.categories);
    }
    const { data: rows, error: idError } = await idQuery;
    if (idError) return NextResponse.json({ error: idError.message }, { status: 500 });
    allIds = (rows ?? []).map((r: { id: string }) => r.id);
  } else {
    allIds = shopIds!;
  }

  const totalRequested = allIds.length;
  const idsToProcess = allIds.slice(0, 50);
  const capped = allIds.length > 50;

  // Fetch shops
  const { data: shops, error: fetchError } = await supabase
    .from("discovered_shops")
    .select("id, primary_email, email_status, email_verified_at")
    .in("id", idsToProcess);

  if (fetchError || !shops) {
    return NextResponse.json({ error: "Failed to fetch shops" }, { status: 500 });
  }

  let verified = 0;
  let skipped = 0;
  let errors = 0;
  const results: Array<{ id: string; email: string; status: string }> = [];

  const mvKey = process.env.MILLIONVERIFIER_API_KEY;

  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i];

    if (!shop.primary_email || shop.primary_email.includes("@placeholder.invalid")) {
      skipped++;
      continue;
    }

    if (shouldSkip(shop.email_status, shop.email_verified_at)) {
      skipped++;
      results.push({ id: shop.id, email: shop.primary_email, status: shop.email_status ?? "unknown" });
      continue;
    }

    if (i > 0) await sleep(200);

    try {
      const mvUrl = `https://api.millionverifier.com/api/v3/?api=${mvKey}&email=${encodeURIComponent(shop.primary_email)}`;
      const mvRes = await fetch(mvUrl);
      const mvData = await mvRes.json();

      if (!mvRes.ok || mvData.error) {
        errors++;
        continue;
      }

      const mappedStatus = mapMVStatus(mvData.result || "", mvData.subresult || "");
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("discovered_shops")
        .update({
          email_status: mappedStatus,
          email_verified_at: now,
        })
        .eq("id", shop.id);

      if (updateError) {
        errors++;
        continue;
      }

      verified++;
      results.push({ id: shop.id, email: shop.primary_email, status: mappedStatus });
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
