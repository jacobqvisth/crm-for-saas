import { describe, it, expect } from "vitest";
import { classifyKind, classifyInbound, buildNumberRows } from "./phone-system";
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
