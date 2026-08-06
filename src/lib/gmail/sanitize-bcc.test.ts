import { describe, it, expect } from "vitest";
import { sanitizeBccAddress } from "./send";

describe("sanitizeBccAddress", () => {
  it("accepts the Trustpilot AFS address shape", () => {
    expect(sanitizeBccAddress("email@trustpilot.co.uk")).toBe(
      "email@trustpilot.co.uk",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeBccAddress("  email@trustpilot.co.uk \t")).toBe(
      "email@trustpilot.co.uk",
    );
  });

  it("treats missing/blank as no Bcc rather than throwing", () => {
    expect(sanitizeBccAddress(undefined)).toBeNull();
    expect(sanitizeBccAddress(null)).toBeNull();
    expect(sanitizeBccAddress("")).toBeNull();
    expect(sanitizeBccAddress("   ")).toBeNull();
  });

  // The value comes from a sequence_settings JSON row. A newline here would
  // let that row append arbitrary MIME headers and fan the customer's email
  // out to recipients nobody approved.
  it("rejects header injection via interior CR/LF", () => {
    expect(sanitizeBccAddress("a@b.com\r\nBcc: attacker@evil.com")).toBeNull();
    expect(sanitizeBccAddress("a@b.com\nTo: attacker@evil.com")).toBeNull();
    expect(sanitizeBccAddress("\r\nTo: attacker@evil.com")).toBeNull();
  });

  // A purely trailing CR/LF carries no payload: trim() removes it and what's
  // left is an ordinary address, so this normalizes rather than rejects.
  // Anything after the newline would survive trim() and is covered above.
  it("normalizes a trailing CR/LF instead of rejecting", () => {
    expect(sanitizeBccAddress("a@b.com\r")).toBe("a@b.com");
    expect(sanitizeBccAddress("a@b.com\n")).toBe("a@b.com");
    expect(sanitizeBccAddress("a@b.com\r\n")).toBe("a@b.com");
  });

  it("rejects address lists, so the Bcc stays the single address promised", () => {
    expect(sanitizeBccAddress("a@b.com,c@d.com")).toBeNull();
    expect(sanitizeBccAddress("a@b.com, c@d.com")).toBeNull();
  });

  it("rejects malformed addresses", () => {
    expect(sanitizeBccAddress("not-an-email")).toBeNull();
    expect(sanitizeBccAddress("@nodomain.com")).toBeNull();
    expect(sanitizeBccAddress("no-at-sign.com")).toBeNull();
    expect(sanitizeBccAddress("a@b")).toBeNull();
    expect(sanitizeBccAddress("a@@b.com")).toBeNull();
    expect(sanitizeBccAddress("spaced out@b.com")).toBeNull();
  });
});
