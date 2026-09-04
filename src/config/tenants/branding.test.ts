import { describe, it, expect } from "vitest";
import { FEATURES } from "../features";
import { wrenchlane } from "./wrenchlane";

// R1: Wrenchlane is a live business and phase 11 must not change a pixel of it.
//
// The /login page and the root layout are proved by diffing a prerender against
// a saved baseline, which catches everything those pages render. The SIDEBAR is
// not prerendered — it sits behind auth — so these assertions stand in for that
// diff. They pin the four strings that used to be hardcoded in
// src/components/sidebar.tsx to exactly the values that were there.
//
// If someone rebrands Wrenchlane later, this test is SUPPOSED to fail. It is
// here so the change is deliberate rather than a side effect of a refactor.
describe("Wrenchlane branding is unchanged by phase 11", () => {
  const b = wrenchlane.identity.branding;

  it("keeps the exact sidebar asset paths", () => {
    expect(b.markSrc).toBe("/wrenchlane-mark.png");
    expect(b.wordmarkSrc).toBe("/wrenchlane-wordmark.png");
  });

  it("keeps the exact sidebar alt text", () => {
    expect(b.markAlt).toBe("Wrenchlane");
    // Verbatim, em dash included, from the pre-phase-11 sidebar.
    expect(b.wordmarkAlt).toBe("Wrenchlane — AI-Driven Car Diagnostics");
  });

  it("keeps the browser title and description that were in layout.tsx", () => {
    // Deliberately still "CRM for SaaS". Renaming the tab is a product
    // decision, not something a productisation refactor gets to do quietly.
    expect(b.browserTitle).toBe("CRM for SaaS");
    expect(b.browserDescription).toBe(
      "Modern CRM with email sequencing for SaaS companies",
    );
  });
});

describe("Wrenchlane sign-in is unchanged by phase 11", () => {
  it("is Google only", () => {
    expect(wrenchlane.auth).toEqual({
      google: true,
      microsoft: false,
      email: false,
    });
  });

  it("never offers a provider without deciding it", () => {
    // Guards the failure the brief calls out by name: a button for a provider
    // the tenant's Supabase project has not had enabled fails with "provider is
    // not enabled" only AFTER the user clicks it.
    const values = Object.values(wrenchlane.auth);
    expect(values.every((v) => typeof v === "boolean")).toBe(true);
    expect(values.some((v) => v)).toBe(true);
  });
});

describe("the feature registry still describes who each feature is for", () => {
  it("gives every feature a non-empty appliesTo", () => {
    // Phase 11 added this so standing up a customer asks the question rather
    // than letting them find a page about fault codes.
    const missing = FEATURES.filter((f) => !f.appliesTo?.trim()).map((f) => f.key);
    expect(missing).toEqual([]);
  });

  it("defaults every feature to on except the declared opt-ins (R2)", () => {
    // R2: Wrenchlane's config is the baseline and must never lose a feature to
    // a registry default. New tenants are switched off per tenant in the
    // control plane instead — see scripts/decide-tenant-features.mjs.
    //
    // `configurators` is Animech's European configurator prospect directory. It
    // is opt-in rather than default-on because Wrenchlane never had it and R2
    // only protects what Wrenchlane already uses; shipping it default-on would
    // put a list of German window manufacturers in a car-diagnostics CRM.
    //
    // The authoritative copy of this list is OFF_BY_DEFAULT in
    // src/config/features.test.ts, which also checks that Wrenchlane's own
    // config agrees with it. This assertion is the second reader; keep them in
    // step.
    const off = FEATURES.filter((f) => !f.enabledByDefault).map((f) => f.key);
    expect(off.sort()).toEqual(["configurators", "linkedin_steps"]);
  });
});
