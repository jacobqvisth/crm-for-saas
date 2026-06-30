import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/calls/phone";
import type { TablesInsert } from "@/lib/database.types";

// Inbound call handler for the dedicated agent numbers.
//
// 46elks hits this URL (set as the number's voice_start) when a customer calls
// one of our numbers back. We:
//   1. find the agent who owns the dialed number (user_profiles.call_caller_id),
//   2. match the caller to a contact (by phone),
//   3. pre-create an INBOUND call_sessions row keyed on the 46elks call id, then
//   4. return a recorded `connect` to the agent's own phone.
//
// The recording + transcript + AI summary + timeline logging then happen exactly
// like an outbound call: 46elks POSTs the recording to the shared hangup webhook,
// which correlates by provider_call_id and runs processCallSession.
//
// 46elks sends no auth headers, so the configured voice_start URL carries
// ?token=CALL_WEBHOOK_SECRET, verified here.
export const maxDuration = 30;

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://crm-for-saas.vercel.app"
  );
}

function pick(form: FormData, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = form.get(k);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const expected = process.env.CALL_WEBHOOK_SECRET;
  if (expected) {
    const token = request.nextUrl.searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({}); // 46elks plays its default
  }

  const callId = pick(form, "callid", "id");
  const callerRaw = pick(form, "from"); // the customer calling us
  const dialedRaw = pick(form, "to"); // our dedicated number they called

  if (!callId || !dialedRaw) return NextResponse.json({});

  const dialed = normalizePhone(dialedRaw) || dialedRaw;
  const supabase = createServiceClient();

  // Which agent owns this number as their caller ID?
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("user_id, call_agent_phone, call_enabled")
    .eq("call_caller_id", dialed)
    .maybeSingle();

  const agentCell = normalizePhone(profile?.call_agent_phone);

  // No owner mapped (or calling disabled) — don't record; let 46elks reject.
  if (!profile || !agentCell || profile.call_enabled === false) {
    return NextResponse.json({ hangup: "reject" });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", profile.user_id)
    .limit(1)
    .maybeSingle();
  const workspaceId = member?.workspace_id ?? null;

  // Match the caller to a contact (best-effort, by phone).
  const callerE164 = normalizePhone(callerRaw);
  let contactId: string | null = null;
  let companyId: string | null = null;
  if (workspaceId && callerE164) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, company_id")
      .eq("workspace_id", workspaceId)
      .eq("phone", callerE164)
      .limit(1)
      .maybeSingle();
    if (contact) {
      contactId = contact.id;
      companyId = contact.company_id ?? null;
    }
  }

  // Pre-create the inbound session so the hangup webhook can correlate it.
  if (workspaceId) {
    const row: TablesInsert<"call_sessions"> = {
      workspace_id: workspaceId,
      contact_id: contactId,
      company_id: companyId,
      user_id: profile.user_id,
      provider: "46elks",
      provider_call_id: callId,
      direction: "inbound",
      from_number: dialed, // our number that was dialed
      agent_number: agentCell, // the agent's phone we bridge to
      to_number: callerE164 ?? callerRaw, // the customer's number
      status: "in_progress",
    };
    // Ignore a duplicate if 46elks re-posts voice_start for the same call.
    const { error } = await supabase.from("call_sessions").insert(row);
    if (error && !error.message.toLowerCase().includes("duplicate")) {
      console.error("inbound webhook: session insert failed", error.message);
    }
  }

  const token = process.env.CALL_WEBHOOK_SECRET ?? "";
  const hangupWebhookUrl = `${appBaseUrl()}/api/calls/webhook/hangup${
    token ? `?token=${encodeURIComponent(token)}` : ""
  }`;

  // Ring the agent's own phone, record it, and feed the recording to the same
  // pipeline as outbound. callerid is omitted on purpose so the agent's phone
  // shows the customer's number (46elks defaults the connect leg to the caller).
  return NextResponse.json({
    connect: agentCell,
    timeout: 25,
    recordcall: hangupWebhookUrl,
    next: hangupWebhookUrl,
    whenhangup: hangupWebhookUrl,
  });
}
