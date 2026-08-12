import { describe, expect, it } from "vitest";
import { voiceSafe, voiceSafeInline } from "./sanitize";
import { pickAgentLanguage } from "./types";

describe("voiceSafe", () => {
  it("replaces long dashes with a comma pause", () => {
    expect(voiceSafe("Free plan — 5 diagnoses")).toBe("Free plan, 5 diagnoses");
    expect(voiceSafe("9–17")).toBe("9, 17");
  });

  it("strips markdown and keeps link labels", () => {
    expect(voiceSafe("**Bold** and [guide](https://x.se/g)")).toBe("Bold and guide");
  });

  it("drops bare URLs", () => {
    expect(voiceSafe("See https://wrenchlane.com/pricing for details")).toBe(
      "See for details",
    );
  });

  it("flattens newlines in the inline variant", () => {
    expect(voiceSafeInline("line one\nline two")).toBe("line one. line two");
  });
});

describe("pickAgentLanguage", () => {
  const enabled = ["sv", "en"];

  it("uses the contact's own language when enabled", () => {
    expect(pickAgentLanguage("sv", "SE", enabled)).toBe("sv");
    expect(pickAgentLanguage("en", "SE", enabled)).toBe("en");
  });

  it("falls back to Swedish for SE contacts without a language", () => {
    expect(pickAgentLanguage(null, "SE", enabled)).toBe("sv");
  });

  it("falls back to English for unsupported languages", () => {
    expect(pickAgentLanguage("ru", "UA", enabled)).toBe("en");
    expect(pickAgentLanguage(null, "PL", enabled)).toBe("en");
  });

  it("handles locale-style codes", () => {
    expect(pickAgentLanguage("sv-SE", "SE", enabled)).toBe("sv");
  });
});
