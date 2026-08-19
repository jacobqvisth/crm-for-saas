import { describe, expect, it } from "vitest";
import { formatCallMemory, type MemoryCall } from "./memory";

const NOW = new Date("2026-08-19T12:00:00Z");

const call = (over: Partial<MemoryCall>): MemoryCall => ({
  started_at: "2026-08-17T09:00:00Z",
  direction: "outbound",
  initiated_by: "agent",
  summary: "Discussed slow diagnostics on their VW fleet. They will try the DTC lookup.",
  ...over,
});

describe("formatCallMemory", () => {
  it("phrases an outbound AI call with its age", () => {
    const line = formatCallMemory([call({})], NOW);
    expect(line).toContain("2 days ago, our AI assistant called them:");
    expect(line).toContain("VW fleet");
  });

  it("distinguishes who was on each call", () => {
    expect(formatCallMemory([call({ initiated_by: "switchboard" })], NOW)).toContain(
      "they called our switchboard",
    );
    expect(
      formatCallMemory([call({ initiated_by: "human", direction: "inbound" })], NOW),
    ).toContain("they called us");
    expect(
      formatCallMemory([call({ initiated_by: "human", direction: "outbound" })], NOW),
    ).toContain("our team called them");
  });

  it("uses natural ages for same-day, yesterday and months", () => {
    expect(formatCallMemory([call({ started_at: "2026-08-19T08:00:00Z" })], NOW)).toContain(
      "earlier today",
    );
    expect(formatCallMemory([call({ started_at: "2026-08-18T08:00:00Z" })], NOW)).toContain(
      "yesterday",
    );
    expect(formatCallMemory([call({ started_at: "2026-05-10T08:00:00Z" })], NOW)).toContain(
      "about 3 months ago",
    );
  });

  it("joins multiple calls newest-first on one line and skips empty summaries", () => {
    const line = formatCallMemory(
      [call({}), call({ started_at: "2026-08-01T09:00:00Z", summary: "  " })],
      NOW,
    );
    expect(line.split(" | ")).toHaveLength(1);
  });

  it("trims long summaries at a word boundary", () => {
    const long = "word ".repeat(120).trim();
    const line = formatCallMemory([call({ summary: long })], NOW);
    expect(line.length).toBeLessThan(360);
    expect(line.endsWith("...")).toBe(true);
    expect(line).not.toMatch(/wor\.\.\.$/);
  });

  it("returns an empty string when there is nothing to remember", () => {
    expect(formatCallMemory([], NOW)).toBe("");
  });
});
