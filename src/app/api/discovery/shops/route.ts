import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  // Auth guard — table has no RLS but API should be authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const country_code = searchParams.get("country_code");
  const status = searchParams.get("status"); // comma-separated or single
  const has_email = searchParams.get("has_email");
  const has_phone = searchParams.get("has_phone");
  const search = searchParams.get("search")?.trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const per_page = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("per_page") ?? "50", 10))
  );

  let query = supabase.from("discovered_shops").select("*", { count: "exact" });

  // Status filter — default to new + enriched
  if (status && status !== "all") {
    const statuses = status.split(",").map((s) => s.trim());
    query = query.in("status", statuses);
  } else if (!status) {
    query = query.in("status", ["new", "enriched"]);
  }

  if (country_code) {
    query = query.eq("country_code", country_code.toUpperCase());
  }

  if (has_email === "true") {
    query = query.not("primary_email", "is", null).neq("primary_email", "");
  }

  if (has_phone === "true") {
    query = query.not("phone", "is", null).neq("phone", "");
  }

  if (search) {
    query = query.or(
      `name.ilike.%${search}%,city.ilike.%${search}%,domain.ilike.%${search}%`
    );
  }

  const from = (page - 1) * per_page;
  const to = from + per_page - 1;

  const { data: shops, count, error } = await query
    .order("scraped_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    shops: shops ?? [],
    total: count ?? 0,
    page,
    per_page,
  });
}
