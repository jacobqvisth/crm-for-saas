import { describe, expect, it } from "vitest";
import {
  INVITE_NOTE_MAX_CHARS,
  defaultLinkedInTitle,
  isLinkedInStepType,
  linkedInTarget,
  linkedInTaskDescription,
} from "./linkedin";
import { TASK_STEP_TYPES, isTaskStepType, walkFromStep } from "./step-walk";

type TargetContact = Parameters<typeof linkedInTarget>[0];

function contact(over: Partial<TargetContact> = {}): TargetContact {
  return {
    linkedin_url: null,
    first_name: "Anna",
    last_name: "Svensson",
    email: "anna@verkstad.se",
    ...over,
  };
}

describe("step type predicate", () => {
  it("recognises both LinkedIn types and nothing else", () => {
    expect(isLinkedInStepType("linkedin_invite")).toBe(true);
    expect(isLinkedInStepType("linkedin_message")).toBe(true);
    for (const other of ["email", "delay", "condition", "call", "task", "", null]) {
      expect(isLinkedInStepType(other), `${other}`).toBe(false);
    }
  });

  // The walk must treat them as non-blocking task steps, or an enrollment
  // parks on a LinkedIn step for ever and every later email stops.
  it("registers them as task steps in the walk", () => {
    expect(isTaskStepType("linkedin_invite")).toBe(true);
    expect(isTaskStepType("linkedin_message")).toBe(true);
    expect(TASK_STEP_TYPES).toContain("linkedin_invite");
  });
});

describe("the walk past LinkedIn steps", () => {
  it("collects them and keeps going to the next email", () => {
    const steps = [
      { id: "a", step_order: 0, type: "linkedin_invite", delay_days: null, delay_hours: null },
      { id: "b", step_order: 1, type: "delay", delay_days: 2, delay_hours: 0 },
      { id: "c", step_order: 2, type: "linkedin_message", delay_days: null, delay_hours: null },
      { id: "d", step_order: 3, type: "email", delay_days: null, delay_hours: null },
    ];

    const walk = walkFromStep(steps, 0);

    expect(walk.taskSteps.map((t) => t.step.id)).toEqual(["a", "c"]);
    expect(walk.emailStep?.id).toBe("d");
    expect(walk.completed).toBe(false);
    // The message step sits after the two-day delay, so it inherits the offset.
    expect(walk.taskSteps[0].offsetMs).toBe(0);
    expect(walk.taskSteps[1].offsetMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(walk.delayDays).toBe(2);
  });

  it("completes a sequence that ends on a LinkedIn step", () => {
    const steps = [
      { id: "a", step_order: 0, type: "email", delay_days: null, delay_hours: null },
      { id: "b", step_order: 1, type: "linkedin_invite", delay_days: null, delay_hours: null },
    ];

    const walk = walkFromStep(steps, 1);

    expect(walk.taskSteps.map((t) => t.step.id)).toEqual(["b"]);
    expect(walk.emailStep).toBeNull();
    expect(walk.completed).toBe(true);
  });
});

describe("choosing where the rep clicks", () => {
  it("uses the profile when the contact has one", () => {
    const t = linkedInTarget(
      contact({ linkedin_url: "https://www.linkedin.com/in/anna-svensson/" }),
      { name: "Verkstad AB" },
    );
    expect(t).toEqual({
      url: "https://www.linkedin.com/in/anna-svensson/",
      kind: "profile",
    });
  });

  // Not a nicety: linkedin_url is null for every contact in the database
  // today, so without this the feature would produce nothing at all.
  it("falls back to a people search built from name and company", () => {
    const t = linkedInTarget(contact(), { name: "Verkstad AB" });
    expect(t?.kind).toBe("search");
    expect(t?.url).toContain("Anna%20Svensson");
    expect(t?.url).toContain("Verkstad%20AB");
  });

  it("searches on the company alone when the person has no name", () => {
    const t = linkedInTarget(contact({ first_name: null, last_name: null }), {
      name: "Verkstad AB",
    });
    expect(t?.kind).toBe("search");
    expect(t?.url).toContain("Verkstad%20AB");
  });

  it("treats a blank profile url as absent", () => {
    const t = linkedInTarget(contact({ linkedin_url: "   " }), { name: "Verkstad AB" });
    expect(t?.kind).toBe("search");
  });

  it("returns null when there is nothing to search on", () => {
    expect(
      linkedInTarget(contact({ first_name: null, last_name: null }), null),
    ).toBeNull();
  });
});

describe("what the rep reads", () => {
  it("leads with the profile, then the message, then the notes", () => {
    const text = linkedInTaskDescription({
      body: "Hi Anna, saw your workshop took on EV work.",
      notes: "She replied to the second email.",
      target: { url: "https://linkedin.com/in/anna", kind: "profile" },
    });

    expect(text).toBe(
      [
        "Profile: https://linkedin.com/in/anna",
        "Send:\nHi Anna, saw your workshop took on EV work.",
        "Notes:\nShe replied to the second email.",
      ].join("\n\n"),
    );
  });

  it("says outright when the link is a guess rather than the person", () => {
    const text = linkedInTaskDescription({
      body: "",
      notes: null,
      target: { url: "https://linkedin.com/search?q=x", kind: "search" },
    });
    expect(text).toContain("No profile on file");
    expect(text).not.toContain("Send:");
    expect(text).not.toContain("Notes:");
  });
});

describe("titles and limits", () => {
  it("names the action, not just the person", () => {
    expect(defaultLinkedInTitle("linkedin_invite", "Anna Svensson")).toBe(
      "LinkedIn invite: Anna Svensson",
    );
    expect(defaultLinkedInTitle("linkedin_message", "Anna Svensson")).toBe(
      "LinkedIn message: Anna Svensson",
    );
  });

  it("keeps the invite-note limit at LinkedIn's published 300", () => {
    expect(INVITE_NOTE_MAX_CHARS).toBe(300);
  });
});
