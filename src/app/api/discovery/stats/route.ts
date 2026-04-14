import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all rows just for status + country_code + presence fields
  // Using aggregation via RPC would be ideal but we can do it client-side
  const { data, error } = await supabase
    .from("discovered_shops")
    .select("status, country_code, primary_email, phone, category") as {
      data: { status: string; country_code: string | null; primary_email: string | null; phone: string | null; category: string | null }[] | null;
      error: { message: string } | null;
    };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  const by_status: Record<string, number> = {};
  const by_country: Record<string, number> = {};
  const by_category: Record<string, number> = {};
  let with_email = 0;
  let with_phone = 0;

  for (const row of rows) {
    // status
    const s = row.status ?? "new";
    by_status[s] = (by_status[s] ?? 0) + 1;

    // country
    const c = row.country_code ?? "??";
    by_country[c] = (by_country[c] ?? 0) + 1;

    // category
    const cat = row.category ?? "Uncategorized";
    by_category[cat] = (by_category[cat] ?? 0) + 1;

    // email / phone
    if (row.primary_email) with_email++;
    if (row.phone) with_phone++;
  }

  return NextResponse.json({
    total: rows.length,
    by_status,
    by_country,
    by_category,
    with_email,
    with_phone,
  });
}
