import { describe, it, expect } from "vitest";
import { walkFromStep, type WalkableStep } from "./step-walk";

function step(
  step_order: number,
  type: string,
  delay_days = 0,
  delay_hours = 0,
): WalkableStep {
  return { id: `s${step_order}`, step_order, type, delay_days, delay_hours };
}

describe("walkFromStep", () => {
  it("returns the next email with no delay", () => {
    const walk = walkFromStep([step(0, "email"), step(1, "email")], 1);
    expect(walk.emailStep?.id).toBe("s1");
    expect(walk.delayDays).toBe(0);
    expect(walk.delayHours).toBe(0);
    expect(walk.currentStep).toBe(1);
    expect(walk.completed).toBe(false);
  });

  it("accumulates a delay before the email", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "delay", 3, 0), step(2, "email")],
      1,
    );
    expect(walk.emailStep?.id).toBe("s2");
    expect(walk.delayDays).toBe(3);
    expect(walk.currentStep).toBe(2);
  });

  it("sums consecutive delays and normalises hours into days", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "delay", 1, 20), step(2, "delay", 0, 6), step(3, "email")],
      1,
    );
    // 1d20h + 6h = 50h = 2d2h
    expect(walk.delayDays).toBe(2);
    expect(walk.delayHours).toBe(2);
    expect(walk.emailStep?.id).toBe("s3");
  });

  it("collects a call step and keeps walking to the email", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "call"), step(2, "delay", 2, 0), step(3, "email")],
      1,
    );
    expect(walk.taskSteps).toHaveLength(1);
    expect(walk.taskSteps[0].step.id).toBe("s1");
    expect(walk.taskSteps[0].offsetMs).toBe(0);
    expect(walk.emailStep?.id).toBe("s3");
    expect(walk.delayDays).toBe(2);
    expect(walk.currentStep).toBe(3);
  });

  it("offsets a task step by the delays that precede it", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "delay", 2, 0), step(2, "task"), step(3, "email")],
      1,
    );
    expect(walk.taskSteps[0].offsetMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(walk.emailStep?.id).toBe("s3");
    // The delay still applies to the email, not just the task.
    expect(walk.delayDays).toBe(2);
  });

  it("collects several task steps in order", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "call"), step(2, "task"), step(3, "email")],
      1,
    );
    expect(walk.taskSteps.map((t) => t.step.id)).toEqual(["s1", "s2"]);
  });

  it("completes when the tail has no email left", () => {
    const walk = walkFromStep([step(0, "email"), step(1, "call")], 1);
    expect(walk.emailStep).toBeNull();
    expect(walk.taskSteps).toHaveLength(1);
    expect(walk.completed).toBe(true);
    expect(walk.currentStep).toBe(2);
  });

  it("completes when the walk starts past the last step", () => {
    const walk = walkFromStep([step(0, "email")], 1);
    expect(walk.emailStep).toBeNull();
    expect(walk.completed).toBe(true);
    expect(walk.currentStep).toBe(1);
  });

  it("stops on a condition step without completing the enrollment", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "condition"), step(2, "email")],
      1,
    );
    expect(walk.emailStep).toBeNull();
    expect(walk.completed).toBe(false);
    expect(walk.currentStep).toBe(1);
  });

  it("keeps task steps found before a condition stop", () => {
    const walk = walkFromStep(
      [step(0, "email"), step(1, "call"), step(2, "condition"), step(3, "email")],
      1,
    );
    expect(walk.taskSteps.map((t) => t.step.id)).toEqual(["s1"]);
    expect(walk.emailStep).toBeNull();
    expect(walk.completed).toBe(false);
  });

  it("ignores steps before fromOrder and tolerates unsorted input", () => {
    const walk = walkFromStep(
      [step(3, "email"), step(1, "delay", 1, 0), step(0, "email"), step(2, "call")],
      1,
    );
    expect(walk.taskSteps.map((t) => t.step.id)).toEqual(["s2"]);
    expect(walk.emailStep?.id).toBe("s3");
    expect(walk.delayDays).toBe(1);
  });

  it("walks a sequence that opens with a call step", () => {
    const walk = walkFromStep([step(0, "call"), step(1, "email")], 0);
    expect(walk.taskSteps[0].step.id).toBe("s0");
    expect(walk.emailStep?.id).toBe("s1");
    expect(walk.currentStep).toBe(1);
  });
});
