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
  const { shop_ids } = body as { shop_ids: string[] };

  if (!Array.isArray(shop_ids) || shop_ids.length === 0) {
    return NextResponse.json({ error: "shop_ids required" }, { status: 400 });
  }

  // Service role client for writes
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("discovered_shops")
    .update({ status: "skipped" })
    .in("id", shop_ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ skipped: shop_ids.length });
}
