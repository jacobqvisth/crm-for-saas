import { describe, expect, it } from "vitest";
import { decideEnrollment, readFieldVisitsSettings } from "./visits-decision";

describe("decideEnrollment", () => {
  const baseCtx = {
    outcome: "interested" as const,
    companyId: "co1",
    companySkipAutoFollowup: false,
    workspaceAutoEnabled: true,
    sequenceId: "seq1",
  };

  it("enrolls on interested when everything is configured", () => {
    expect(decideEnrollment(baseCtx)).toEqual({ enroll: true, sequenceId: "seq1" });
  });

  it("blocks when explicit override is false", () => {
    const r = decideEnrollment({ ...baseCtx, enrollOverride: false });
    expect(r).toEqual({ enroll: false, reason: "explicit_override" });
  });

  it("blocks when outcome default is no-enroll (skipped)", () => {
    const r = decideEnrollment({ ...baseCtx, outcome: "skipped" });
    expect(r).toEqual({ enroll: false, reason: "outcome_default" });
  });

  it("blocks when outcome is not_interested", () => {
    const r = decideEnrollment({ ...baseCtx, outcome: "not_interested" });
    expect(r).toEqual({ enroll: false, reason: "outcome_default" });
  });

  it("blocks when outcome is closed (already a customer)", () => {
    const r = decideEnrollment({ ...baseCtx, outcome: "closed" });
    expect(r).toEqual({ enroll: false, reason: "outcome_default" });
  });

  it("blocks when there's no company id", () => {
    const r = decideEnrollment({ ...baseCtx, companyId: null });
    expect(r).toEqual({ enroll: false, reason: "no_company" });
  });

  it("blocks when company has skip_auto_followup", () => {
    const r = decideEnrollment({ ...baseCtx, companySkipAutoFollowup: true });
    expect(r).toEqual({ enroll: false, reason: "company_skip_auto_followup" });
  });

  it("blocks when workspace auto-enroll is disabled", () => {
    const r = decideEnrollment({ ...baseCtx, workspaceAutoEnabled: false });
    expect(r).toEqual({ enroll: false, reason: "workspace_disabled" });
  });

  it("blocks when no sequence is configured for the outcome", () => {
    const r = decideEnrollment({ ...baseCtx, sequenceId: null });
    expect(r).toEqual({ enroll: false, reason: "no_sequence_configured" });
  });

  it("explicit override true defeats outcome default for skipped", () => {
    const r = decideEnrollment({ ...baseCtx, outcome: "skipped", enrollOverride: true });
    expect(r).toEqual({ enroll: true, sequenceId: "seq1" });
  });

  it("explicit override false beats outcome default for interested (1st gate)", () => {
    const r = decideEnrollment({ ...baseCtx, enrollOverride: false });
    expect(r).toEqual({ enroll: false, reason: "explicit_override" });
  });

  it("no_answer enrolls when configured", () => {
    const r = decideEnrollment({ ...baseCtx, outcome: "no_answer" });
    expect(r).toEqual({ enroll: true, sequenceId: "seq1" });
  });

  // Decision-order check: explicit_override beats no_company
  it("explicit_override fires before no_company", () => {
    const r = decideEnrollment({
      ...baseCtx,
      enrollOverride: false,
      companyId: null,
    });
    expect(r).toEqual({ enroll: false, reason: "explicit_override" });
  });

  // Decision-order check: company skip beats workspace disabled
  it("company_skip_auto_followup fires before workspace_disabled", () => {
    const r = decideEnrollment({
      ...baseCtx,
      companySkipAutoFollowup: true,
      workspaceAutoEnabled: false,
    });
    expect(r).toEqual({ enroll: false, reason: "company_skip_auto_followup" });
  });
});

describe("readFieldVisitsSettings", () => {
  it("returns empty for null/undefined/non-object", () => {
    expect(readFieldVisitsSettings(null)).toEqual({});
    expect(readFieldVisitsSettings(undefined)).toEqual({});
    expect(readFieldVisitsSettings("oops")).toEqual({});
    expect(readFieldVisitsSettings(42)).toEqual({});
  });

  it("returns empty when field_visits subkey is missing", () => {
    expect(readFieldVisitsSettings({ other: { x: 1 } })).toEqual({});
  });

  it("returns the nested shape", () => {
    const settings = {
      field_visits: {
        auto_followup_enabled: false,
        sequence_by_outcome: { interested: "seq-uuid" },
      },
    };
    expect(readFieldVisitsSettings(settings)).toEqual({
      auto_followup_enabled: false,
      sequence_by_outcome: { interested: "seq-uuid" },
    });
  });
});
