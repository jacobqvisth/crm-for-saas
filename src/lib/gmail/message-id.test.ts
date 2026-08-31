import { describe, expect, it } from "vitest";
import { messageIdForQueueRow, normalizeMessageId } from "./message-id";

describe("messageIdForQueueRow", () => {
  it("mints an angle-bracketed id on the sender's own domain", () => {
    expect(
      messageIdForQueueRow("0be32354-d08d-4ed6-bb2f-44d632739b3c", "hans@wrenchlane.com"),
    ).toBe("<crm-0be32354-d08d-4ed6-bb2f-44d632739b3c@wrenchlane.com>");
  });

  it("is deterministic, which is what lets a follow-up recompute it", () => {
    const a = messageIdForQueueRow("abc-123", "hans.m@wrenchlane.com");
    const b = messageIdForQueueRow("abc-123", "hans.m@wrenchlane.com");
    expect(a).toBe(b);
  });

  it("lowercases the domain and ignores the local part", () => {
    expect(messageIdForQueueRow("row1", "Hans.Markebrant@WrenchLane.COM")).toBe(
      "<crm-row1@wrenchlane.com>",
    );
  });

  it("returns null for a missing or unusable row id", () => {
    expect(messageIdForQueueRow(null, "hans@wrenchlane.com")).toBeNull();
    expect(messageIdForQueueRow("", "hans@wrenchlane.com")).toBeNull();
    // Header injection attempt via the row id.
    expect(messageIdForQueueRow("a@b>\r\nBcc: x@y.z", "hans@wrenchlane.com")).toBeNull();
  });

  it("falls back to a valid domain rather than emitting <id@>", () => {
    // An invalid header is the exact failure this module prevents, so a
    // wrong-but-valid domain beats a malformed one.
    expect(messageIdForQueueRow("row1", "not-an-address")).toBe(
      "<crm-row1@wrenchlane.com>",
    );
  });
});

describe("normalizeMessageId", () => {
  it("rejects a bare Gmail API id, which is the bug this guards", () => {
    // This is the value that used to ship as `In-Reply-To: 1a0384f90cd42904`.
    expect(normalizeMessageId("1a0384f90cd42904")).toBeNull();
  });

  it("adds missing angle brackets to a real identifier", () => {
    expect(normalizeMessageId("abc@mail.example.com")).toBe("<abc@mail.example.com>");
  });

  it("passes an already-bracketed id through unchanged", () => {
    expect(normalizeMessageId("<abc@mail.example.com>")).toBe("<abc@mail.example.com>");
  });

  it("rejects CRLF and whitespace so nothing can inject a header", () => {
    expect(normalizeMessageId("a@b.com\r\nBcc: x@y.z")).toBeNull();
    expect(normalizeMessageId("a b@c.com")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId("  ")).toBeNull();
  });
});
