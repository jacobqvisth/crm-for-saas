import { describe, expect, it } from "vitest";

import { renderQueuedEmail, type RenderableQueueItem } from "./render";

type Row = Record<string, unknown>;

/**
 * Tiny chainable mock that mimics the subset of the Supabase JS builder
 * `renderQueuedEmail` uses: `from(table).select(...).eq(col, val).maybeSingle()`.
 * Each `from(table)` call returns the next pre-loaded result, in order.
 */
function makeSupabase(results: Array<{ data: Row | null }>) {
  const calls: Array<{ table: string; selectCols?: string; eqArgs: Array<[string, unknown]> }> = [];
  let idx = 0;

  const builder = (table: string) => {
    const state = { table, selectCols: undefined as string | undefined, eqArgs: [] as Array<[string, unknown]> };
    calls.push(state);

    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => {
      state.selectCols = cols;
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      state.eqArgs.push([col, val]);
      return chain;
    };
    chain.maybeSingle = async () => results[idx++] ?? { data: null };
    return chain;
  };

  return {
    client: { from: builder } as never,
    calls,
  };
}

const baseItem: RenderableQueueItem = {
  step_id: "step-1",
  variant_id: null,
  contact_id: "contact-1",
  tracking_id: "track-1",
  subject: "[stale subject]",
  body_html: "<p>[stale body]</p>",
};

const baseContact: Row = {
  id: "contact-1",
  first_name: "Anna",
  last_name: "Karlsson",
  email: "anna@example.com",
  phone: "+46123",
  custom_fields: null,
  companies: { name: "Verkstad AB" },
};

describe("renderQueuedEmail", () => {
  it("re-renders subject and body from the live step, replacing the frozen item content", async () => {
    const { client } = makeSupabase([
      {
        data: {
          id: "step-1",
          subject_override: "Hej {{first_name}}",
          body_override: "<p>Hej {{first_name}} på {{company_name}}!</p>",
          template_id: null,
        },
      },
      { data: baseContact },
    ]);

    const result = await renderQueuedEmail(client, baseItem);

    expect(result.reRendered).toBe(true);
    expect(result.subject).toBe("Hej Anna");
    expect(result.bodyHtml).toContain("Hej Anna på Verkstad AB");
    // Existing body had stale text; live render should replace it entirely.
    expect(result.bodyHtml).not.toContain("[stale body]");
  });

  it("prefers a pinned variant's body over the step's body_override", async () => {
    const { client } = makeSupabase([
      {
        data: {
          id: "step-1",
          subject_override: "Step subj",
          body_override: "<p>Step body</p>",
          template_id: null,
        },
      },
      {
        data: {
          subject: "Variant subj for {{first_name}}",
          body_html: "<p>Variant body for {{first_name}}</p>",
          is_active: true,
        },
      },
      { data: baseContact },
    ]);

    const result = await renderQueuedEmail(client, {
      ...baseItem,
      variant_id: "variant-A",
    });

    expect(result.reRendered).toBe(true);
    expect(result.subject).toBe("Variant subj for Anna");
    expect(result.bodyHtml).toContain("Variant body for Anna");
    expect(result.bodyHtml).not.toContain("Step body");
  });

  it("falls back to the queued content when the step has been deleted", async () => {
    const { client } = makeSupabase([
      { data: null }, // step lookup misses
    ]);

    const result = await renderQueuedEmail(client, baseItem);

    expect(result.reRendered).toBe(false);
    expect(result.subject).toBe("[stale subject]");
    expect(result.bodyHtml).toBe("<p>[stale body]</p>");
  });

  it("falls back to the queued content when the contact has been deleted", async () => {
    const { client } = makeSupabase([
      {
        data: {
          id: "step-1",
          subject_override: "Hej {{first_name}}",
          body_override: "<p>Hej {{first_name}}</p>",
          template_id: null,
        },
      },
      { data: null }, // contact lookup misses
    ]);

    const result = await renderQueuedEmail(client, baseItem);

    expect(result.reRendered).toBe(false);
    expect(result.subject).toBe("[stale subject]");
    expect(result.bodyHtml).toBe("<p>[stale body]</p>");
  });

  it("appends an unsubscribe link when one isn't already in the rendered body", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
    const { client } = makeSupabase([
      {
        data: {
          id: "step-1",
          subject_override: "Hej",
          body_override: "<p>No unsub link here</p>",
          template_id: null,
        },
      },
      { data: baseContact },
    ]);

    const result = await renderQueuedEmail(client, baseItem);

    expect(result.reRendered).toBe(true);
    expect(result.bodyHtml).toContain("/api/tracking/unsubscribe/track-1");
  });

  it("returns the frozen content unchanged when step_id is null", async () => {
    const { client } = makeSupabase([]);

    const result = await renderQueuedEmail(client, { ...baseItem, step_id: null });

    expect(result.reRendered).toBe(false);
    expect(result.subject).toBe("[stale subject]");
    expect(result.bodyHtml).toBe("<p>[stale body]</p>");
  });
});
