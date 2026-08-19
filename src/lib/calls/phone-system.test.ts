import { describe, it, expect } from "vitest";
import {
  classifyKind,
  classifyInbound,
  buildNumberRows,
  describeNumber,
} from "./phone-system";
import type { ElksNumber } from "./elks";

describe("classifyKind", () => {
  it("flags websocket numbers as data", () => {
    expect(classifyKind({ number: "+4600700106", active: "yes", capabilities: ["websocket"] })).toBe("data");
  });
  it("flags +4600 numbers as sip", () => {
    expect(classifyKind({ number: "+4600120210", active: "yes", capabilities: ["voice"] })).toBe("sip");
  });
  it("treats normal mobile numbers as mobile", () => {
    expect(classifyKind({ number: "+46766860335", active: "yes", capabilities: ["voice", "sms"] })).toBe("mobile");
  });
});

describe("classifyInbound", () => {
  it("none → unconfigured", () => {
    expect(classifyInbound(undefined).type).toBe("unconfigured");
    expect(classifyInbound("").type).toBe("unconfigured");
  });
  it("result-insurance edge fn", () => {
    expect(classifyInbound("https://46elks:x@ugibcnidxrhcxflqamxs.supabase.co/functions/v1/call-inbound").type).toBe(
      "result_insurance",
    );
  });
  it("crm inbound handler", () => {
    expect(classifyInbound("https://crm-for-saas.vercel.app/api/calls/webhook/inbound?token=x").type).toBe("crm");
  });
  it("sip endpoint", () => {
    expect(classifyInbound("https://external.46elks.com/sipcalling?callerid=%2B46766861606").type).toBe("sip");
  });
  it("static connect → forward with target", () => {
    const r = classifyInbound('{"connect":"+4600120210"}');
    expect(r.type).toBe("forward");
    if (r.type === "forward") expect(r.to).toBe("+4600120210");
  });
  it("other webhook → host", () => {
    const r = classifyInbound("https://example.com/hook");
    expect(r.type).toBe("webhook");
    if (r.type === "webhook") expect(r.host).toBe("example.com");
  });
});

describe("buildNumberRows", () => {
  const numbers: ElksNumber[] = [
    { number: "+4600700106", active: "yes", capabilities: ["websocket"] },
    { number: "+46766860335", active: "yes", capabilities: ["voice", "sms"], allocated: "2026-04-14T00:00:00" },
    { number: "+46766864306", active: "yes", capabilities: ["voice", "sms"] },
  ];

  it("sorts mobiles first, marks default + assignment", () => {
    const callerMap = new Map<string, string[]>([["+46766860335", ["Jacob"]]]);
    const rows = buildNumberRows(numbers, callerMap, "+46766860335");
    expect(rows[0].kind).toBe("mobile");
    expect(rows[rows.length - 1].kind).toBe("data");
    const def = rows.find((r) => r.number === "+46766860335")!;
    expect(def.isDefaultCallerId).toBe(true);
    expect(def.assignedTo).toEqual(["Jacob"]);
    const spare = rows.find((r) => r.number === "+46766864306")!;
    expect(spare.assignedTo).toEqual([]);
    expect(spare.allocated).toBe(null);
  });
});

describe("describeNumber", () => {
  const RI = "https://46elks:x@ugibcnidxrhcxflqamxs.supabase.co/functions/v1/call-inbound";

  it("keeps a number Wrenchlane uses even when its inbound belongs to another product", () => {
    // The real trap: +46766860335 routes inbound to result-insurance, but it is
    // also the outbound AI agent's number and the fallback caller ID. Classifying
    // on inbound alone invites someone to release a number this CRM depends on.
    const n: ElksNumber = { number: "+46766860335", active: "yes", voice_start: RI };
    const out = describeNumber(
      n,
      { agentNumbers: new Map([["+46766860335", "Elsa"]]), defaultCallerId: "+46766860335" },
      [],
    );
    expect(out.ownership).toBe("shared");
    expect(out.keepReason).toContain("Elsa");
    expect(out.purpose).toContain("Elsa");
  });

  it("labels a purely foreign number as another product's", () => {
    const n: ElksNumber = { number: "+46766864306", active: "yes", voice_start: RI };
    const out = describeNumber(n, {}, []);
    expect(out.ownership).toBe("other_product");
    expect(out.keepReason).toBeNull();
  });

  it("explains a WebRTC number that somebody actually uses", () => {
    // The page used to show these as "callback rings nothing" because they have no
    // voice_start, which read as unused despite hundreds of calls.
    const n: ElksNumber = {
      number: "+4600120210",
      active: "yes",
      capabilities: ["voice", "webrtc"],
    };
    const out = describeNumber(n, { webrtcNumbers: new Map([["+4600120210", "Valdemar"]]) }, []);
    expect(out.ownership).toBe("wrenchlane");
    expect(out.purpose).toContain("Valdemar");
    expect(out.keepReason).toContain("Valdemar");
  });

  it("flags an unassigned WebRTC endpoint as unclaimed", () => {
    const n: ElksNumber = {
      number: "+4600120210",
      active: "yes",
      capabilities: ["voice", "webrtc"],
    };
    expect(describeNumber(n, {}, []).ownership).toBe("unknown");
  });

  it("marks the switchboard and its bridge as must-keep", () => {
    const vaxel: ElksNumber = {
      number: "+46766867161",
      active: "yes",
      voice_start: "https://crm-for-saas.vercel.app/api/switchboard/inbound?token=x",
    };
    const bridge: ElksNumber = {
      number: "+4600700495",
      active: "yes",
      capabilities: ["websocket"],
      websocket_url: "wss://x.supabase.co/functions/v1/switchboard-bridge",
    };
    const ctx = { switchboardNumber: "+46766867161", bridgeNumber: "+4600700495" };
    expect(describeNumber(vaxel, ctx, []).ownership).toBe("wrenchlane");
    const b = describeNumber(bridge, ctx, []);
    expect(b.ownership).toBe("wrenchlane");
    expect(b.keepReason).toContain("silent");
  });

  it("names a rep's caller ID by the person using it", () => {
    const n: ElksNumber = {
      number: "+46766869603",
      active: "yes",
      voice_start: "https://crm-for-saas.vercel.app/api/calls/webhook/inbound?token=x",
    };
    const out = describeNumber(n, {}, ["Jacob Qvisth"]);
    expect(out.ownership).toBe("wrenchlane");
    expect(out.purpose).toContain("Jacob Qvisth");
  });
});
