import { describe, it, expect } from "vitest";
import {
  hasReplyPrefix,
  stripReplyPrefixes,
  threadedReplySubject,
} from "./reply-subject";

describe("stripReplyPrefixes", () => {
  it("leaves a plain subject alone", () => {
    expect(stripReplyPrefixes("WrenchLane - rychlejší diagnostika")).toBe(
      "WrenchLane - rychlejší diagnostika",
    );
  });

  it("strips one marker", () => {
    expect(stripReplyPrefixes("Re: Faster diagnostics")).toBe(
      "Faster diagnostics",
    );
  });

  it("strips a stack of them", () => {
    expect(stripReplyPrefixes("Re: Re: Re: Faster diagnostics")).toBe(
      "Faster diagnostics",
    );
  });

  it("strips the markers other clients write", () => {
    expect(stripReplyPrefixes("SV: Snabbare diagnos")).toBe("Snabbare diagnos");
    expect(stripReplyPrefixes("AW: Schnellere Diagnose")).toBe(
      "Schnellere Diagnose",
    );
    expect(stripReplyPrefixes("Re[2]: Faster diagnostics")).toBe(
      "Faster diagnostics",
    );
  });

  it("does not eat a subject that merely contains a colon", () => {
    expect(stripReplyPrefixes("Reminder: your trial ends")).toBe(
      "Reminder: your trial ends",
    );
    expect(stripReplyPrefixes("Q4: plans")).toBe("Q4: plans");
  });

  it("returns empty for a subject that is nothing but markers", () => {
    expect(stripReplyPrefixes("Re: Re:")).toBe("");
  });
});

describe("hasReplyPrefix", () => {
  it("recognises a reply regardless of casing", () => {
    expect(hasReplyPrefix("re: hello")).toBe(true);
    expect(hasReplyPrefix("RE: hello")).toBe(true);
  });

  it("does not fire on a plain subject", () => {
    expect(hasReplyPrefix("Faster diagnostics")).toBe(false);
  });
});

describe("threadedReplySubject", () => {
  // The bug this exists for: a follow-up step with no subject of its own
  // inherits the previous send's, which already carries a "Re: ".
  it("does not stack markers across steps", () => {
    expect(threadedReplySubject("", "Re: WrenchLane - Faster diagnostics")).toBe(
      "Re: WrenchLane - Faster diagnostics",
    );
  });

  it("adds one marker to the first follow-up", () => {
    expect(threadedReplySubject("", "WrenchLane - Faster diagnostics")).toBe(
      "Re: WrenchLane - Faster diagnostics",
    );
  });

  it("keeps the thread on the previous subject, not the step's own", () => {
    // Changing the base subject mid-sequence splits the conversation in the
    // reader's inbox, so the previous send wins.
    expect(threadedReplySubject("A different subject", "Original subject")).toBe(
      "Re: Original subject",
    );
  });

  it("falls back to the step's own subject when there is no previous one", () => {
    expect(threadedReplySubject("Own subject", null)).toBe("Re: Own subject");
  });

  it("returns null when there is nothing to build from", () => {
    expect(threadedReplySubject("", "")).toBeNull();
    expect(threadedReplySubject("", null)).toBeNull();
    expect(threadedReplySubject("Re:", "Re: Re:")).toBeNull();
  });
});
