import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { placeBridgeCall } from "@/lib/calls/elks";
import { normalizePhone } from "@/lib/calls/phone";
import type { TablesInsert } from "@/lib/database.types";

export const maxDuration = 30;

const DialBody = z.object({
  contactId: z.string().uuid(),
  listId: z.string().uuid().nullish(),
  /** Override the company-level do-not-contact / NIX block for a deliberate call. */
  override: z.boolean().optional(),
  /** Explicit number to dial (chosen from the shared pool). Falls back to the
   *  contact's stored primary phone when absent. */
  to: z.string().nullish(),
  /** Which leg to ring as the agent: their mobile ("bridge", default) or the
   *  browser via the 46elks WebRTC number ("webrtc" — talk from the computer). */
  mode: z.enum(["bridge", "webrtc"]).optional(),
});

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://crm-for-saas.vercel.app"
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = DialBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { contactId, listId, override, to } = parsed.data;
  const mode = parsed.data.mode ?? "bridge";

  // Load the contact (RLS scopes to the user's workspace).
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, workspace_id, company_id, phone, first_name, last_name, country_code")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const workspaceId = contact.workspace_id;

  // Membership check (defense in depth alongside RLS).
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Resolve the number to dial: the explicit pick (from the pool picker) when
  // provided, else the contact's stored primary phone. Use the contact's
  // country as the hint so national numbers expand to the right country code
  // (a bare "358…" is already international and normalizes correctly regardless).
  const contactPhone = normalizePhone(to || contact.phone, contact.country_code);
  if (!contactPhone) {
    return NextResponse.json(
      { error: "This contact has no valid phone number" },
      { status: 400 },
    );
  }

  // Respect company-level do-not-contact / NIX unless deliberately overridden.
  if (contact.company_id && !override) {
    const { data: company } = await supabase
      .from("companies")
      .select("do_not_contact, nix_blocked")
      .eq("id", contact.company_id)
      .maybeSingle();
    if (company?.do_not_contact || company?.nix_blocked) {
      return NextResponse.json(
        {
          error: "blocked",
          blocked: company.nix_blocked ? "nix" : "do_not_contact",
          message: company.nix_blocked
            ? "This company is on the NIX call-block list."
            : "This company is marked do-not-contact.",
        },
        { status: 409 },
      );
    }
  }

  // Per-user dialer config: this agent's own phone (required) + their own
  // caller ID (falls back to the shared env default). Each member rings their
  // own phone and shows their own caller ID — see user_profiles.call_*.
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("call_agent_phone, call_caller_id, call_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profile?.call_enabled === false) {
    return NextResponse.json({ error: "Calling is disabled for your account" }, { status: 403 });
  }

  // Resolve the agent leg 46elks rings. Phone bridge → their mobile; computer
  // (WebRTC) → the shared 46elks WebRTC number, which their browser is
  // registered to and auto-answers. Everything downstream is identical.
  let ring: string;
  if (mode === "webrtc") {
    const webrtcNumber = normalizePhone(process.env.ELKS_WEBRTC_NUMBER);
    if (!webrtcNumber) {
      return NextResponse.json(
        {
          error: "webrtc_unavailable",
          message: "Computer calling isn't configured (ELKS_WEBRTC_NUMBER).",
        },
        { status: 400 },
      );
    }
    ring = webrtcNumber;
  } else {
    const agentPhone = normalizePhone(profile?.call_agent_phone);
    if (!agentPhone) {
      return NextResponse.json(
        { error: "no_agent_phone", message: "Set your phone number in Call Settings first." },
        { status: 400 },
      );
    }
    ring = agentPhone;
  }
  const callerId =
    normalizePhone(profile?.call_caller_id) ||
    normalizePhone(process.env.CRM_CALL_FROM_NUMBER) ||
    null;
  if (!callerId) {
    return NextResponse.json(
      { error: "no_caller_id", message: "No caller ID configured (settings or CRM_CALL_FROM_NUMBER)." },
      { status: 500 },
    );
  }

  // Hangup/recording webhook URL — carries a shared secret 46elks echoes back.
  const token = process.env.CALL_WEBHOOK_SECRET ?? "";
  const hangupWebhookUrl = `${appBaseUrl()}/api/calls/webhook/hangup${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  // Place the bridged call.
  let callId: string;
  try {
    const result = await placeBridgeCall({
      from: callerId,
      ring,
      contactPhone,
      hangupWebhookUrl,
    });
    callId = result.callId;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to place call" },
      { status: 502 },
    );
  }

  // Record the session so the webhook + UI can correlate it.
  const row: TablesInsert<"call_sessions"> = {
    workspace_id: workspaceId,
    contact_id: contactId,
    company_id: contact.company_id ?? null,
    user_id: user.id,
    list_id: listId ?? null,
    provider: "46elks",
    provider_call_id: callId,
    direction: "outbound",
    from_number: callerId,
    agent_number: ring,
    to_number: contactPhone,
    status: "dialing",
  };
  const { data: session, error: insErr } = await supabase
    .from("call_sessions")
    .insert(row)
    .select("id")
    .single();
  if (insErr) {
    // The call is already ringing; surface the id even if our row failed.
    return NextResponse.json(
      { ok: true, callId, sessionId: null, warning: `session insert failed: ${insErr.message}` },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, callId, sessionId: session.id });
}
