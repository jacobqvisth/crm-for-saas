import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    const supabase = await createClient();

    // Step 1: Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    results.step1_auth = {
      authenticated: !!user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      error: authError?.message ?? null,
    };

    if (!user) {
      return NextResponse.json({ ...results, conclusion: "NOT AUTHENTICATED - log in first" });
    }

    // Step 2: Check workspace membership
    const { data: memberships, error: memberError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id);

    results.step2_membership = {
      memberships,
      error: memberError?.message ?? null,
    };

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ ...results, conclusion: "NO WORKSPACE MEMBERSHIP" });
    }

    const workspaceId = memberships[0].workspace_id;

    // Step 3: Check workspace exists
    const { data: workspace, error: wsError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .single();

    results.step3_workspace = {
      workspace,
      error: wsError?.message ?? null,
    };

    // Step 4: Try inserting a test contact
    const { data: contact, error: insertError } = await supabase
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        email: `test-${Date.now()}@example.com`,
        first_name: "Test",
        last_name: "Contact",
        status: "active",
        lead_status: "new",
      })
      .select()
      .single();

    results.step4_insert = {
      success: !!contact,
      contact_id: contact?.id ?? null,
      error: insertError?.message ?? null,
      error_details: insertError?.details ?? null,
      error_hint: insertError?.hint ?? null,
      error_code: insertError?.code ?? null,
    };

    // Step 5: If insert worked, clean it up
    if (contact) {
      await supabase.from("contacts").delete().eq("id", contact.id);
      results.step5_cleanup = "deleted test contact";
    }

    results.conclusion = contact ? "ALL WORKING" : "INSERT FAILED - see step4 error";

  } catch (err) {
    results.unexpected_error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
