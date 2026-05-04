import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("user_profiles")
    .select("full_name, title, signature_html, signature_updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    email: user.email,
    full_name: data?.full_name ?? null,
    title: data?.title ?? null,
    signature_html: data?.signature_html ?? null,
    signature_updated_at: data?.signature_updated_at ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { full_name, title, signature_html } = body as {
    full_name?: string | null;
    title?: string | null;
    signature_html?: string | null;
  };

  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: user.id,
      full_name: full_name ?? null,
      title: title ?? null,
      signature_html: signature_html ?? null,
      signature_updated_at: signature_html ? new Date().toISOString() : null,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
