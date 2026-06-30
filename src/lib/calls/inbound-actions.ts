// Builds the 46elks voice-action tree for an inbound call to a dedicated number.
//
// 46elks `connect` supports a `timeout` (ring seconds) plus nested `failed` /
// `busy` actions that run when the leg isn't answered — so the whole hunt group
// + voicemail is one JSON response, no extra webhook round-trips:
//
//   ring owner (timeout) → no answer → ring failover agent (timeout)
//                                     → no answer → voicemail (beep + record)
//
// recordcall records the whole call (the conversation when answered); the
// voicemail `record` captures the message when nobody answers. Both POST to the
// shared hangup webhook, which transcribes + logs them.

export interface InboundActionConfig {
  /** The number's owner — rung first. E.164. */
  primaryCell: string;
  /** Seconds to ring the owner before giving up. */
  ringSeconds: number;
  /** Another agent rung if the owner doesn't answer. E.164, or null. */
  failoverCell: string | null;
  /** Seconds to ring the failover agent. */
  failoverRingSeconds: number;
  /** Take a recorded voicemail when nobody answers. */
  voicemailEnabled: boolean;
  /** Webhook 46elks POSTs the recording(s) + hangup info to (already tokenized). */
  recordHookUrl: string;
}

export interface VoiceAction {
  connect?: string;
  timeout?: number;
  callerid?: string;
  recordcall?: string;
  whenhangup?: string;
  play?: string;
  record?: string;
  timelimit?: number;
  silencedetection?: string;
  next?: VoiceAction;
  failed?: VoiceAction;
  busy?: VoiceAction;
}

function voicemailAction(hook: string): VoiceAction {
  // A beep, then record the caller's message (stops after 3s silence or 120s).
  return {
    play: "beep",
    next: {
      record: hook,
      timelimit: 120,
      silencedetection: "yes",
    },
  };
}

export function buildInboundActions(cfg: InboundActionConfig): VoiceAction {
  const vm = cfg.voicemailEnabled ? voicemailAction(cfg.recordHookUrl) : null;

  // What happens after the owner doesn't answer.
  let afterPrimary: VoiceAction | null;
  if (cfg.failoverCell) {
    const failover: VoiceAction = {
      connect: cfg.failoverCell,
      timeout: cfg.failoverRingSeconds,
      // callerid omitted → the failover agent's phone shows the customer's number.
    };
    if (vm) {
      failover.failed = vm;
      failover.busy = vm;
    }
    afterPrimary = failover;
  } else {
    afterPrimary = vm; // may be null (no failover, no voicemail → call just ends)
  }

  const actions: VoiceAction = {
    recordcall: cfg.recordHookUrl,
    whenhangup: cfg.recordHookUrl,
    connect: cfg.primaryCell,
    timeout: cfg.ringSeconds,
  };
  if (afterPrimary) {
    actions.failed = afterPrimary;
    actions.busy = afterPrimary;
  }
  return actions;
}
