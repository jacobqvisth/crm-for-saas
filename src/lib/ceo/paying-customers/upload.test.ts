import { describe, expect, it } from "vitest";
import { transactionIdFor } from "./upload";

describe("transactionIdFor", () => {
  it("is stable for the same workshop and payment day", () => {
    // The point of deriving it rather than generating one: a retry after a
    // timeout, where we do not know whether Google accepted the first attempt,
    // must send the SAME id so their side deduplicates instead of counting a
    // second conversion.
    const a = transactionIdFor("ws-1", "2026-07-14T09:30:00Z");
    const b = transactionIdFor("ws-1", "2026-07-14T23:59:59Z");
    expect(a).toBe(b);
  });

  it("differs per workshop", () => {
    expect(transactionIdFor("ws-1", "2026-07-14T09:30:00Z")).not.toBe(
      transactionIdFor("ws-2", "2026-07-14T09:30:00Z"),
    );
  });

  it("differs when the payment lands on a different day", () => {
    expect(transactionIdFor("ws-1", "2026-07-14T09:30:00Z")).not.toBe(
      transactionIdFor("ws-1", "2026-07-15T09:30:00Z"),
    );
  });

  it("carries a recognisable prefix, so a stray id is traceable to this repo", () => {
    expect(transactionIdFor("ws-1", "2026-07-14T09:30:00Z")).toMatch(/^wl-firstpaid-/);
  });
});
