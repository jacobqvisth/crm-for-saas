import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDomain, extractDomain } from "@/lib/warmup/domain-check";

interface RouteContext {
  params: Promise<{ accountId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const supabase = await createClient();
  const { accountId } = await context.params;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: account } = await supabase
    .from("gmail_accounts")
    .select("id, workspace_id, email_address")
    .eq("id", accountId)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const domain = extractDomain(account.email_address);
  const result = await checkDomain(domain);

  await supabase
    .from("gmail_accounts")
    .update({ domain_health: result as unknown as Record<string, unknown> })
    .eq("id", accountId);

  return NextResponse.json(result);
}
