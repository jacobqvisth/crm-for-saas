import { describe, it, expect } from "vitest";
import { sipUsernameFor } from "./phone";

// The SIP username for a 46elks WebRTC number is the number without the leading
// "+", per their VoIP client docs. Getting this wrong means the browser silently
// fails to register and computer calling just never rings, so it is worth pinning.
describe("sipUsernameFor", () => {
  it("strips the leading plus", () => {
    expect(sipUsernameFor("+4600120210")).toBe("4600120210");
  });

  it("leaves an already-bare number alone", () => {
    expect(sipUsernameFor("4600120210")).toBe("4600120210");
  });

  it("only strips a LEADING plus", () => {
    // Defensive: normalizePhone should never produce this, but the transform must
    // not quietly mangle the rest of the number if it does.
    expect(sipUsernameFor("46001+20210")).toBe("46001+20210");
  });
});
