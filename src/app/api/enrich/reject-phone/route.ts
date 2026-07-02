import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/calls/phone";
import { withRejectedPhone } from "@/lib/enrich/rejected-phones";
import type { Json } from "@/lib/database.types";

/**
 * Mark a phone number as "not correct" for a contact or company. The number is
 * stored on the record's custom_fields.rejected_phones so the phone finder never
 * surfaces (or auto-saves) it again.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, contactId, companyId, number, countryCode } = body as {
    workspaceId: string;
    contactId?: string;
    companyId?: string;
    number: string;
    countryCode?: string | null;
  };

  if (!workspaceId || !number) {
    return NextResponse.json({ error: "Missing workspaceId or number" }, { status: 400 });
  }
  if (!contactId && !companyId) {
    return NextResponse.json({ error: "Missing contactId or companyId" }, { status: 400 });
  }

  // Workspace membership check
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const e164 = normalizePhone(number, countryCode ?? null) ?? number.trim();

  // Store on the record the user was looking at (the contact, if any).
  if (contactId) {
    const { data: rec } = await supabase
      .from("contacts")
      .select("custom_fields")
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!rec) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const { error } = await supabase
      .from("contacts")
      .update({ custom_fields: withRejectedPhone(rec.custom_fields, e164) as Json })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);
    if (error) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
  } else if (companyId) {
    const { data: rec } = await supabase
      .from("companies")
      .select("custom_fields")
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!rec) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const { error } = await supabase
      .from("companies")
      .update({ custom_fields: withRejectedPhone(rec.custom_fields, e164) as Json })
      .eq("id", companyId)
      .eq("workspace_id", workspaceId);
    if (error) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, number: e164 });
}
