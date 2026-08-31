import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStepTasks } from "./step-tasks";
import type { Database, Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

/**
 * Captures the rows handed to `upsert` without touching a database.
 *
 * Only the one chain `createStepTasks` uses is modelled — `.from().upsert()
 * .select()` — so a change to how it writes shows up as a type error here
 * rather than as a silently passing test.
 */
function fakeSupabase() {
  const captured: Record<string, unknown>[][] = [];
  const client = {
    from() {
      return {
        upsert(rows: Record<string, unknown>[]) {
          captured.push(rows);
          return {
            select: async () => ({ data: rows.map((_, i) => ({ id: `t${i}` })), error: null }),
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, captured };
}

const contact = {
  id: "c1",
  company_id: "co1",
  first_name: "Anna",
  last_name: "Svensson",
  email: "anna@verkstad.se",
  linkedin_url: null,
} as unknown as Contact;

const company = { name: "Verkstad AB" } as unknown as Company;

function step(over: Record<string, unknown> = {}) {
  return {
    step: {
      id: "s1",
      step_order: 1,
      type: "linkedin_invite",
      task_title: null,
      task_description: null,
      task_priority: null,
      task_due_days: 0,
      linkedin_body: "Hi {{first_name}}.",
      delay_days: null,
      delay_hours: null,
      ...over,
    },
    offsetMs: 0,
  } as Parameters<typeof createStepTasks>[1]["taskSteps"][number];
}

const base = {
  workspaceId: "w1",
  enrollmentId: "e1",
  contact,
  company,
  baseDate: new Date("2026-09-01T09:00:00Z"),
};

describe("the feature gate", () => {
  // The load-bearing case. A sequence built while the flag was on keeps its
  // LinkedIn steps after the flag goes off, and those must stop producing work
  // for a tenant that no longer has the feature.
  it("creates nothing for LinkedIn steps when the tenant lacks the feature", async () => {
    const { client, captured } = fakeSupabase();

    const res = await createStepTasks(client, {
      ...base,
      taskSteps: [step()],
      linkedinEnabled: false,
    });

    expect(res).toEqual({ created: 0, error: null });
    expect(captured).toEqual([]);
  });

  it("still creates the call and task steps beside them", async () => {
    const { client, captured } = fakeSupabase();

    await createStepTasks(client, {
      ...base,
      taskSteps: [step(), step({ id: "s2", type: "call", linkedin_body: null })],
      linkedinEnabled: false,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toHaveLength(1);
    expect(captured[0][0].type).toBe("call");
  });
});

describe("the task a rep receives", () => {
  it("routes to the LinkedIn queue with the message and a target", async () => {
    const { client, captured } = fakeSupabase();

    await createStepTasks(client, {
      ...base,
      taskSteps: [step()],
      linkedinEnabled: true,
    });

    const row = captured[0][0];
    expect(row.type).toBe("linkedin");
    expect(row.title).toBe("LinkedIn invite: Anna Svensson");
    // Variables resolve against the contact, exactly as in an email step.
    expect(row.description).toContain("Hi Anna.");
    // No linkedin_url on this contact, so the target is a search and says so.
    expect(row.description).toContain("No profile on file");
  });

  it("uses the real profile when the contact has one", async () => {
    const { client, captured } = fakeSupabase();

    await createStepTasks(client, {
      ...base,
      contact: { ...contact, linkedin_url: "https://linkedin.com/in/anna" } as Contact,
      taskSteps: [step()],
      linkedinEnabled: true,
    });

    expect(captured[0][0].description).toContain("Profile: https://linkedin.com/in/anna");
  });

  it("skips a contact who cannot be identified on LinkedIn at all", async () => {
    const { client, captured } = fakeSupabase();

    const res = await createStepTasks(client, {
      ...base,
      contact: { ...contact, first_name: null, last_name: null } as Contact,
      company: null,
      taskSteps: [step()],
      linkedinEnabled: true,
    });

    expect(res.created).toBe(0);
    expect(captured).toEqual([]);
  });

  it("honours the step's own due offset", async () => {
    const { client, captured } = fakeSupabase();

    await createStepTasks(client, {
      ...base,
      taskSteps: [step({ task_due_days: 2 })],
      linkedinEnabled: true,
    });

    expect(captured[0][0].due_date).toBe(new Date("2026-09-03T09:00:00Z").toISOString());
  });

  it("leaves a call step's description as plain notes", async () => {
    const { client, captured } = fakeSupabase();

    await createStepTasks(client, {
      ...base,
      taskSteps: [
        step({ type: "call", linkedin_body: null, task_description: "Ask about EV work." }),
      ],
      linkedinEnabled: true,
    });

    expect(captured[0][0].description).toBe("Ask about EV work.");
    expect(captured[0][0].type).toBe("call");
  });
});
