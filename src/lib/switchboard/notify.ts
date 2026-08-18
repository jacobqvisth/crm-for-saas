import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

// The "screen pop" for a transfer.
//
// ElevenLabs' warm-transfer announcement (the whispered "I have Erik calling
// about a Volvo") is only available on their native Twilio integration, not over
// a SIP trunk. Rather than lose the context, we push it to Slack the moment the
// receptionist decides to transfer, which lands before the phone finishes
// ringing and carries more than a whisper could: who they are in the CRM, and a
// link straight to their record.
//
// Optional by design: with no webhook configured this is a no-op, and the
// transfer still works. The context is always written to switchboard_calls
// regardless, so nothing is lost.

export interface NotifyParams {
  supabase: Client;
  workspaceId: string;
  targetLabel: string;
  callerName: string | null;
  callerNumber: string | null;
  reason: string | null;
  contactId: string | null;
  companyId: string | null;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://crm-for-saas.vercel.app"
  );
}

export async function notifySlack(p: NotifyParams): Promise<void> {
  const webhook = process.env.SLACK_SWITCHBOARD_WEBHOOK_URL?.trim();
  if (!webhook) return;

  let who = p.callerName?.trim() || p.callerNumber || "Unknown caller";
  let companyLine = "";

  if (p.companyId) {
    const { data: company } = await p.supabase
      .from("companies")
      .select("name")
      .eq("id", p.companyId)
      .maybeSingle();
    if (company?.name) companyLine = ` from *${company.name}*`;
  }

  if (p.contactId) {
    who = `<${appBaseUrl()}/contacts/${p.contactId}|${who}>`;
  }

  const lines = [
    `:telephone_receiver: *Incoming call for ${p.targetLabel}* — your phone is ringing now.`,
    `${who}${companyLine}${p.callerNumber ? ` · ${p.callerNumber}` : ""}`,
  ];
  if (p.reason) lines.push(`_${p.reason}_`);
  if (!p.contactId && !p.companyId) lines.push("_Not in the CRM yet._");

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch {
    // A failed notification must never break a live call.
  }
}
