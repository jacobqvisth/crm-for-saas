import "server-only";
import { buildInboundActions, type VoiceAction } from "@/lib/calls/inbound-actions";
import { agentSipUri } from "@/lib/call-agent/dial";
import type { SwitchboardTarget } from "./types";

// The 46elks action trees for a switchboard call.
//
// The whole transfer trick lives here: the FIRST action connects the caller to
// the receptionist over SIP and chains a `next`. When the receptionist hangs up
// its own leg (via the end_call tool), 46elks requests that `next` URL and
// continues the SAME call with whatever we return. So the caller is put through
// without ever being re-dialled or hearing a second ring.
//
// This is the same `connect` + `next` chaining that placeBridgeCall already
// relies on for outbound human calls, so the mechanism is proven in this
// codebase; what is new is chaining it after a SIP leg rather than a PSTN one.

export interface AgentLegParams {
  /** The växel number, which is also the imported ElevenLabs SIP identifier. */
  switchboardNumber: string;
  /** Absolute URL 46elks requests when the receptionist's leg ends. */
  nextUrl: string;
  /** Absolute URL for the recording + hangup POST. */
  recordHookUrl: string;
}

/**
 * Connect the caller to the AI receptionist, chaining the transfer handler.
 *
 * 46elks accepts `next` as either a nested action or a URL string. We need the
 * URL form, because who to ring is only known once the receptionist has spoken
 * to the caller. The shared VoiceAction type models `next` as a nested action,
 * so this returns a plain payload rather than bending that type.
 */
export function buildAgentLegPayload(p: AgentLegParams): Record<string, unknown> {
  return {
    recordcall: p.recordHookUrl,
    whenhangup: p.recordHookUrl,
    connect: agentSipUri(p.switchboardNumber),
    next: p.nextUrl,
  };
}

export interface TransferParams {
  target: SwitchboardTarget;
  /** Rung if the primary target does not answer. */
  failover: SwitchboardTarget | null;
  ringSeconds: number;
  voicemailEnabled: boolean;
  recordHookUrl: string;
}

/**
 * Ring the requested human, fall back to their failover, then voicemail.
 *
 * Delegates to the existing hunt-group builder so inbound-to-a-rep and
 * inbound-through-the-switchboard behave identically and there is one place
 * where ring/failover/voicemail semantics live.
 */
export function buildTransferAction(p: TransferParams): VoiceAction | null {
  const primary = p.target.phone;
  if (!primary) return null;

  return buildInboundActions({
    primaryCell: primary,
    // No parallel browser leg: the switchboard rings phones, and the shared
    // WebRTC number can only be registered by one person at a time.
    computerNumber: null,
    ringSeconds: p.ringSeconds,
    failoverCell: p.failover?.phone ?? null,
    failoverRingSeconds: p.ringSeconds,
    voicemailEnabled: p.voicemailEnabled,
    recordHookUrl: p.recordHookUrl,
  });
}

/** Voicemail with no human attempt: outside hours, or nobody reachable. */
export function buildVoicemailAction(recordHookUrl: string): VoiceAction {
  return {
    play: "beep",
    next: {
      record: recordHookUrl,
      timelimit: 120,
      silencedetection: "yes",
    },
  };
}

/** Resolve a target's failover, guarding against a self- or dead reference. */
export function resolveFailover(
  target: SwitchboardTarget,
  all: SwitchboardTarget[],
): SwitchboardTarget | null {
  if (!target.failover_target_id) return null;
  const found = all.find(
    (t) => t.id === target.failover_target_id && t.id !== target.id && t.enabled && t.phone,
  );
  return found ?? null;
}

/** Targets that could actually take a call right now (enabled, has a phone). */
export function reachableTargets(all: SwitchboardTarget[]): SwitchboardTarget[] {
  return all.filter((t) => t.enabled && Boolean(t.phone));
}
