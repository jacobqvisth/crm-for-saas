import { describe, it, expect } from "vitest";
import { sameSubjectText } from "./translate-outbound";

// The guard that catches a subject line the translation left in the source
// language. It has to be forgiving about casing and whitespace (the model
// reformats both freely) without ever calling two genuinely different
// subjects the same.
describe("sameSubjectText", () => {
  it("matches an untranslated subject handed straight back", () => {
    expect(
      sameSubjectText(
        "WrenchLane - Faster diagnostics",
        "WrenchLane - Faster diagnostics",
      ),
    ).toBe(true);
  });

  it("ignores casing and surrounding whitespace", () => {
    expect(
      sameSubjectText("  Faster diagnostics ", "faster   diagnostics"),
    ).toBe(true);
  });

  it("does not match a real translation", () => {
    expect(
      sameSubjectText(
        "WrenchLane - Faster diagnostics",
        "WrenchLane - Rychlejší diagnostika",
      ),
    ).toBe(false);
  });

  it("does not match when only part of the subject moved", () => {
    expect(
      sameSubjectText("Faster diagnostics", "Faster diagnostics for you"),
    ).toBe(false);
  });
});
