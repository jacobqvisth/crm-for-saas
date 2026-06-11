import { describe, expect, it } from "vitest";
import { decideEnrollment, nextLeadStatus, readCallSettings } from "./decision";

describe("decideEnrollment (calls)", () => {
  const baseCtx = {
    outcome: "interested" as const,
    contactActive: true,
    workspaceAutoEnabled: true,
    sequenceId: "seq1",
  };

  it("enrolls on interested when everything is configured", () => {
    expect(decideEnrollment(baseCtx)).toEqual({ enroll: true, sequenceId: "seq1" });
  });

  it("enrolls on no_answer (worth a follow-up sequence)", () => {
    expect(decideEnrollment({ ...baseCtx, outcome: "no_answer" })).toEqual({
      enroll: true,
      sequenceId: "seq1",
    });
  });

  it("blocks when explicit override is false", () => {
    expect(decideEnrollment({ ...baseCtx, enrollOverride: false })).toEqual({
      enroll: false,
      reason: "explicit_override",
    });
  });

  it("blocks when outcome default is no-enroll (not_interested)", () => {
    expect(decideEnrollment({ ...baseCtx, outcome: "not_interested" })).toEqual({
      enroll: false,
      reason: "outcome_default",
    });
  });

  it("blocks callback_scheduled (handled by a task, not a sequence)", () => {
    expect(decideEnrollment({ ...baseCtx, outcome: "callback_scheduled" })).toEqual({
      enroll: false,
      reason: "outcome_default",
    });
  });

  it("blocks wrong_number", () => {
    expect(decideEnrollment({ ...baseCtx, outcome: "wrong_number" })).toEqual({
      enroll: false,
      reason: "outcome_default",
    });
  });

  it("blocks an unsubscribed/bounced contact", () => {
    expect(decideEnrollment({ ...baseCtx, contactActive: false })).toEqual({
      enroll: false,
      reason: "contact_unsubscribed",
    });
  });

  it("blocks when workspace auto-followup is disabled", () => {
    expect(decideEnrollment({ ...baseCtx, workspaceAutoEnabled: false })).toEqual({
      enroll: false,
      reason: "workspace_disabled",
    });
  });

  it("blocks when no sequence is configured for the outcome", () => {
    expect(decideEnrollment({ ...baseCtx, sequenceId: null })).toEqual({
      enroll: false,
      reason: "no_sequence_configured",
    });
  });

  it("honours an explicit enroll override on a normally-no-enroll outcome", () => {
    expect(
      decideEnrollment({ ...baseCtx, outcome: "not_interested", enrollOverride: true }),
    ).toEqual({ enroll: true, sequenceId: "seq1" });
  });
});

describe("nextLeadStatus", () => {
  it("advances a new lead to contacted on a connected call", () => {
    expect(nextLeadStatus("new", "no_answer", true)).toBe("contacted");
  });

  it("does not advance on a no-answer that didn't connect", () => {
    expect(nextLeadStatus("new", "no_answer", false)).toBeNull();
  });

  it("advances to qualified on interested", () => {
    expect(nextLeadStatus("contacted", "interested", true)).toBe("qualified");
  });

  it("advances to customer on closed", () => {
    expect(nextLeadStatus("qualified", "closed", true)).toBe("customer");
  });

  it("never downgrades (qualified stays qualified on a plain connected call)", () => {
    expect(nextLeadStatus("qualified", "no_answer", true)).toBeNull();
  });

  it("treats null current status as 'new'", () => {
    expect(nextLeadStatus(null, "interested", true)).toBe("qualified");
  });

  it("does not downgrade a customer", () => {
    expect(nextLeadStatus("customer", "interested", true)).toBeNull();
  });
});

describe("readCallSettings", () => {
  it("returns empty object for non-object input", () => {
    expect(readCallSettings(null)).toEqual({});
    expect(readCallSettings("nope")).toEqual({});
  });

  it("extracts the calls block from workspace settings", () => {
    const settings = { calls: { auto_followup_enabled: false, sequence_by_outcome: { interested: "seq9" } } };
    expect(readCallSettings(settings)).toEqual({
      auto_followup_enabled: false,
      sequence_by_outcome: { interested: "seq9" },
    });
  });

  it("returns empty when there is no calls block", () => {
    expect(readCallSettings({ field_visits: {} })).toEqual({});
  });
});
