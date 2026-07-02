// Pure classification helpers for the Phone System overview page.
// Import-free of Supabase / fetch so it stays unit-testable.

import type { ElksNumber } from "./elks";

/** What a number is good for. */
export type NumberKind = "mobile" | "sip" | "data";

/** Where inbound calls to a number currently land. */
export type InboundRouting =
  | { type: "unconfigured" } // callback rings nothing
  | { type: "result_insurance" } // result-insurance edge fn (separate product)
  | { type: "crm" } // this CRM's inbound webhook
  | { type: "sip" } // a SIP endpoint
  | { type: "forward"; to: string } // static connect to a phone
  | { type: "webhook"; host: string }; // some other webhook

export interface PhoneNumberRow {
  number: string;
  active: boolean;
  allocated: string | null;
  kind: NumberKind;
  capabilities: string[];
  inbound: InboundRouting;
  /** Agent display names that use this number as their outbound caller ID. */
  assignedTo: string[];
  /** True when this is the shared default caller ID (CRM_CALL_FROM_NUMBER). */
  isDefaultCallerId: boolean;
}

export function classifyKind(n: ElksNumber): NumberKind {
  const caps = n.capabilities ?? [];
  if (caps.includes("websocket")) return "data";
  // 46elks "00…" numbers are SIP / virtual endpoints, not customer-facing mobiles.
  if (n.number.startsWith("+4600")) return "sip";
  return "mobile";
}

export function classifyInbound(voiceStart: string | undefined | null): InboundRouting {
  const vs = (voiceStart ?? "").trim();
  if (!vs) return { type: "unconfigured" };
  if (vs.includes("ugibcnidxrhcxflqamxs")) return { type: "result_insurance" };
  if (vs.includes("crm-for-saas") || vs.includes("/api/calls/webhook/inbound")) {
    return { type: "crm" };
  }
  if (vs.includes("sipcalling") || vs.includes("sip:")) return { type: "sip" };
  if (vs.startsWith("{")) {
    try {
      const parsed = JSON.parse(vs) as { connect?: string };
      if (parsed.connect) return { type: "forward", to: parsed.connect };
    } catch {
      /* fall through */
    }
  }
  try {
    return { type: "webhook", host: new URL(vs).host };
  } catch {
    return { type: "webhook", host: "custom action" };
  }
}

export const INBOUND_LABEL: Record<InboundRouting["type"], string> = {
  unconfigured: "Not handled — callback rings nothing",
  result_insurance: "Result-Insurance inbound flow",
  crm: "This CRM's inbound handler",
  sip: "SIP endpoint",
  forward: "Forwards to a phone",
  webhook: "Custom webhook",
};

/**
 * Build the display rows for the Phone System page.
 *
 * @param numbers   raw 46elks numbers
 * @param callerIdToAgents map of E.164 caller-ID -> agent display names that use it
 * @param defaultCallerId the shared CRM_CALL_FROM_NUMBER (env), if any
 */
export function buildNumberRows(
  numbers: ElksNumber[],
  callerIdToAgents: Map<string, string[]>,
  defaultCallerId: string | null,
): PhoneNumberRow[] {
  return numbers
    .map((n): PhoneNumberRow => ({
      number: n.number,
      active: n.active === "yes",
      allocated: n.allocated ? n.allocated.slice(0, 10) : null,
      kind: classifyKind(n),
      capabilities: n.capabilities ?? [],
      inbound: classifyInbound(n.voice_start),
      assignedTo: callerIdToAgents.get(n.number) ?? [],
      isDefaultCallerId: !!defaultCallerId && n.number === defaultCallerId,
    }))
    // Customer-facing mobiles first, then SIP, then data; stable within group.
    .sort((a, b) => {
      const order: Record<NumberKind, number> = { mobile: 0, sip: 1, data: 2 };
      return order[a.kind] - order[b.kind];
    });
}
