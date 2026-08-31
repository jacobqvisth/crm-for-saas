import { describe, expect, it } from "vitest";
import { parseThreadingHeaders } from "./fetch-threading-headers";

describe("parseThreadingHeaders", () => {
  it("reads the sender's own Message-ID", () => {
    const parsed = parseThreadingHeaders([
      { name: "Message-ID", value: "<CAD5rp-Vj5Sw@mail.gmail.com>" },
    ]);
    expect(parsed.messageId).toBe("<CAD5rp-Vj5Sw@mail.gmail.com>");
  });

  it("matches the header name case-insensitively, as Gmail returns Message-Id", () => {
    const parsed = parseThreadingHeaders([
      { name: "Message-Id", value: "<a@b.com>" },
    ]);
    expect(parsed.messageId).toBe("<a@b.com>");
  });

  it("splits a References chain and keeps it in thread order", () => {
    const parsed = parseThreadingHeaders([
      { name: "References", value: "<first@x.com> <second@x.com> <third@x.com>" },
    ]);
    expect(parsed.references).toEqual([
      "<first@x.com>",
      "<second@x.com>",
      "<third@x.com>",
    ]);
  });

  it("handles a References chain folded across lines", () => {
    const parsed = parseThreadingHeaders([
      { name: "References", value: "<first@x.com>\r\n <second@x.com>" },
    ]);
    expect(parsed.references).toEqual(["<first@x.com>", "<second@x.com>"]);
  });

  it("drops tokens that are not message identifiers", () => {
    // A bare Gmail API id is the exact value that used to ship as In-Reply-To.
    const parsed = parseThreadingHeaders([
      { name: "References", value: "<good@x.com> 1a04c29dff0d12db" },
    ]);
    expect(parsed.references).toEqual(["<good@x.com>"]);
  });

  it("returns empty rather than null-ish junk when the headers are absent", () => {
    expect(parseThreadingHeaders([])).toEqual({ messageId: null, references: [] });
  });

  it("returns no message id when the header is present but malformed", () => {
    const parsed = parseThreadingHeaders([
      { name: "Message-ID", value: "1a04c29dff0d12db" },
    ]);
    expect(parsed.messageId).toBeNull();
  });
});
