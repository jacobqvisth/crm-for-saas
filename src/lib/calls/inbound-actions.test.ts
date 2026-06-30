import { describe, it, expect } from "vitest";
import { buildInboundActions } from "./inbound-actions";

const HOOK = "https://app.example/api/calls/webhook/hangup?token=x";

describe("buildInboundActions", () => {
  it("records + rings the owner with their timeout", () => {
    const a = buildInboundActions({
      primaryCell: "+46700000001",
      ringSeconds: 30,
      failoverCell: null,
      failoverRingSeconds: 25,
      voicemailEnabled: false,
      recordHookUrl: HOOK,
    });
    expect(a.connect).toBe("+46700000001");
    expect(a.timeout).toBe(30);
    expect(a.recordcall).toBe(HOOK);
    // no failover + no voicemail → call just ends on no-answer
    expect(a.failed).toBeUndefined();
    expect(a.busy).toBeUndefined();
  });

  it("falls over to the backup agent on no-answer and busy", () => {
    const a = buildInboundActions({
      primaryCell: "+46700000001",
      ringSeconds: 25,
      failoverCell: "+46700000002",
      failoverRingSeconds: 20,
      voicemailEnabled: false,
      recordHookUrl: HOOK,
    });
    expect(a.failed?.connect).toBe("+46700000002");
    expect(a.failed?.timeout).toBe(20);
    expect(a.busy?.connect).toBe("+46700000002");
    // voicemail off → failover has no tail
    expect(a.failed?.failed).toBeUndefined();
  });

  it("takes a voicemail after the failover agent also misses", () => {
    const a = buildInboundActions({
      primaryCell: "+46700000001",
      ringSeconds: 25,
      failoverCell: "+46700000002",
      failoverRingSeconds: 25,
      voicemailEnabled: true,
      recordHookUrl: HOOK,
    });
    const vm = a.failed?.failed;
    expect(vm?.play).toBe("beep");
    expect(vm?.next?.record).toBe(HOOK);
    expect(vm?.next?.silencedetection).toBe("yes");
  });

  it("goes straight to voicemail when there is no failover agent", () => {
    const a = buildInboundActions({
      primaryCell: "+46700000001",
      ringSeconds: 25,
      failoverCell: null,
      failoverRingSeconds: 25,
      voicemailEnabled: true,
      recordHookUrl: HOOK,
    });
    expect(a.failed?.play).toBe("beep");
    expect(a.failed?.next?.record).toBe(HOOK);
  });
});
