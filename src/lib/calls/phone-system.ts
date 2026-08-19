// Pure classification helpers for the Phone System overview page.
// Import-free of Supabase / fetch so it stays unit-testable.

import type { ElksNumber } from "./elks";

/** What a number is good for. */
export type NumberKind = "mobile" | "sip" | "data";

/** Where inbound calls to a number currently land. */
export type InboundRouting =
  | { type: "unconfigured" } // callback rings nothing
  | { type: "result_insurance" } // result-insurance edge fn (separate product)
  | { type: "crm" } // this CRM's inbound webhook (rings the number's owner)
  | { type: "switchboard" } // the AI receptionist answers, then transfers
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
  /** Plain-English reason we pay for this number. */
  purpose: string;
  /** Does Wrenchlane depend on it, or does it belong to another product? */
  ownership: NumberOwnership;
  /** Set when it must NOT be released despite looking idle or foreign. */
  keepReason: string | null;
}

/**
 * Who a number is for. Judged on every role it plays, not only its inbound
 * routing, because a number can be Wrenchlane's outbound caller ID while its
 * inbound points somewhere else entirely.
 */
export type NumberOwnership = "wrenchlane" | "shared" | "other_product" | "unknown";

export interface PurposeContext {
  /** The published switchboard number. */
  switchboardNumber?: string | null;
  /** The websocket number the switchboard's AI leg is bridged to. */
  bridgeNumber?: string | null;
  /** Numbers imported as an AI agent's phone number, mapped to the agent name. */
  agentNumbers?: Map<string, string>;
  /** Per-user WebRTC numbers, mapped to the person's name. */
  webrtcNumbers?: Map<string, string>;
  /** The shared default caller ID from CRM_CALL_FROM_NUMBER. */
  defaultCallerId?: string | null;
}

/**
 * Work out what a number is for and whether we can let it go.
 *
 * Deliberately checks the Wrenchlane roles BEFORE the inbound routing. The
 * caller-ID number for the outbound AI agent has its inbound pointed at
 * result-insurance, so classifying on inbound alone labels it as another
 * product's and invites someone to release a number this CRM depends on.
 */
export function describeNumber(
  n: ElksNumber,
  ctx: PurposeContext,
  assignedTo: string[],
): { purpose: string; ownership: NumberOwnership; keepReason: string | null } {
  const vs = `${n.voice_start ?? ""}${n.websocket_url ?? ""}`;
  const roles: string[] = [];
  let keepReason: string | null = null;

  if (ctx.switchboardNumber && n.number === ctx.switchboardNumber) {
    roles.push("the published switchboard number customers call");
  }
  if (ctx.bridgeNumber && n.number === ctx.bridgeNumber) {
    roles.push("carries the receptionist's audio (WebSocket bridge)");
    keepReason = "The switchboard's AI leg is connected to this; calls go silent without it.";
  }
  const agentName = ctx.agentNumbers?.get(n.number);
  if (agentName) {
    roles.push(`imported as the phone number for ${agentName}`);
    keepReason = `${agentName} places calls from this number.`;
  }
  const webrtcOwner = ctx.webrtcNumbers?.get(n.number);
  if (webrtcOwner) {
    roles.push(`${webrtcOwner} takes calls in the browser on this`);
    keepReason = `${webrtcOwner} would lose "calls on this computer".`;
  }
  if (assignedTo.length) {
    roles.push(`caller ID shown by ${assignedTo.join(", ")}`);
  }
  if (ctx.defaultCallerId && n.number === ctx.defaultCallerId) {
    roles.push("the fallback caller ID for anyone without their own");
    keepReason ??= "Used as CRM_CALL_FROM_NUMBER when a rep has no caller ID of their own.";
  }

  if (roles.length) {
    return {
      purpose: roles.join("; "),
      // A number Wrenchlane uses whose inbound belongs elsewhere is shared, and
      // that is exactly the case worth spelling out rather than simplifying.
      ownership: vs.includes("ugibcnidxrhcxflqamxs") ? "shared" : "wrenchlane",
      keepReason,
    };
  }

  if (vs.includes("ugibcnidxrhcxflqamxs")) {
    return {
      purpose: "Result-Insurance inbound flow, nothing in this CRM uses it",
      ownership: "other_product",
      keepReason: null,
    };
  }
  if (vs.includes("xefryvntcnqcepsbdiki")) {
    return {
      purpose: "Demo app receptionist, nothing in this CRM uses it",
      ownership: "other_product",
      keepReason: null,
    };
  }
  if (vs.includes("sipcalling")) {
    return {
      purpose: "Legacy 46elks SIP client endpoint, no traffic",
      ownership: "unknown",
      keepReason: null,
    };
  }
  if (vs.startsWith("{")) {
    return {
      purpose: `Static forward only: ${vs.slice(0, 48)}`,
      ownership: "unknown",
      keepReason: null,
    };
  }
  if ((n.capabilities ?? []).includes("webrtc")) {
    return {
      purpose: "A WebRTC endpoint with nobody assigned to it",
      ownership: "unknown",
      keepReason: null,
    };
  }
  return { purpose: "No routing and no role in this CRM", ownership: "unknown", keepReason: null };
}

export const OWNERSHIP_LABEL: Record<NumberOwnership, string> = {
  wrenchlane: "Wrenchlane",
  shared: "Shared",
  other_product: "Another product",
  unknown: "Unclaimed",
};

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
  // Check the switchboard first: its URL also contains the app host, so the
  // broader CRM match below would otherwise swallow it.
  if (vs.includes("/api/switchboard/inbound")) return { type: "switchboard" };
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
  unconfigured: "Not handled, callback rings nothing",
  result_insurance: "Result-Insurance inbound flow",
  crm: "Rings the owner, then failover, then voicemail",
  switchboard: "Switchboard: the receptionist answers",
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
  purposeCtx: PurposeContext = {},
): PhoneNumberRow[] {
  const ctx: PurposeContext = { ...purposeCtx, defaultCallerId };
  return numbers
    .map((n): PhoneNumberRow => {
      const assignedTo = callerIdToAgents.get(n.number) ?? [];
      const described = describeNumber(n, ctx, assignedTo);
      return {
        number: n.number,
        active: n.active === "yes",
        allocated: n.allocated ? n.allocated.slice(0, 10) : null,
        kind: classifyKind(n),
        capabilities: n.capabilities ?? [],
        inbound: classifyInbound(n.voice_start),
        assignedTo,
        isDefaultCallerId: !!defaultCallerId && n.number === defaultCallerId,
        purpose: described.purpose,
        ownership: described.ownership,
        keepReason: described.keepReason,
      };
    })
    // Customer-facing mobiles first, then SIP, then data; stable within group.
    .sort((a, b) => {
      const order: Record<NumberKind, number> = { mobile: 0, sip: 1, data: 2 };
      return order[a.kind] - order[b.kind];
    });
}
