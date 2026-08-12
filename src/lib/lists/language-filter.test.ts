import { describe, it, expect } from "vitest";
import { applyListFilters, describeFilter, type ListFilter } from "./filter-query";
import { languageVariants } from "@/lib/i18n/languages";

/**
 * Minimal stand-in for a PostgREST query builder: records the calls a filter
 * makes so we can assert on the shape of the query rather than hitting the DB.
 */
function fakeQuery() {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: Record<string, unknown> = {};
  for (const method of ["eq", "neq", "in", "is", "not", "ilike", "gte", "lte", "lt", "gt"]) {
    q[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return q;
    };
  }
  return { q, calls };
}

describe("languageVariants", () => {
  it("returns every raw tag that means the same language", () => {
    // contacts.language holds `nb` for Norwegian app users while the label map
    // is keyed on `no`, so a filter for Norwegian has to match both.
    expect(languageVariants("no").sort()).toEqual(["nb", "nn", "no"]);
    expect(languageVariants("nb").sort()).toEqual(["nb", "nn", "no"]);
  });

  it("returns just the code for languages with no aliases", () => {
    expect(languageVariants("en")).toEqual(["en"]);
    expect(languageVariants("en-GB")).toEqual(["en"]);
  });

  it("returns nothing for an empty code so the filter can be skipped", () => {
    expect(languageVariants(null)).toEqual([]);
    expect(languageVariants("")).toEqual([]);
  });
});

describe("applyListFilters — language", () => {
  it("matches a single language through .in() over its variants", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [{ field: "language", operator: "equals", value: "en" }]);
    expect(calls).toEqual([{ method: "in", args: ["language", ["en"]] }]);
  });

  it("expands Norwegian to the tags contacts actually store", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [{ field: "language", operator: "equals", value: "no" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("in");
    expect((calls[0].args[1] as string[]).sort()).toEqual(["nb", "nn", "no"]);
  });

  it("negates over the full variant set", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [{ field: "language", operator: "not_equals", value: "sv" }]);
    expect(calls).toEqual([{ method: "not", args: ["language", "in", "(sv)"] }]);
  });

  it("dedupes overlapping variants across an 'is any of' selection", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [
      { field: "language", operator: "in", value: ["no", "nb", "en"] },
    ]);
    expect((calls[0].args[1] as string[]).sort()).toEqual(["en", "nb", "nn", "no"]);
  });

  it("skips a language row with no value rather than matching everything", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [{ field: "language", operator: "equals", value: null }]);
    expect(calls).toEqual([]);
  });

  it("still uses plain null checks for is_null / is_not_null", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [
      { field: "language", operator: "is_null", value: null },
      { field: "language", operator: "is_not_null", value: null },
    ]);
    expect(calls).toEqual([
      { method: "is", args: ["language", null] },
      { method: "not", args: ["language", "is", null] },
    ]);
  });

  it("leaves other fields on the original code path", () => {
    const { q, calls } = fakeQuery();
    applyListFilters(q, [{ field: "user_plan_type", operator: "equals", value: "free" }]);
    expect(calls).toEqual([{ method: "eq", args: ["user_plan_type", "free"] }]);
  });
});

describe("describeFilter — language", () => {
  it("shows the language name rather than the code", () => {
    const filter: ListFilter = { field: "language", operator: "equals", value: "en" };
    expect(describeFilter(filter)).toBe("Language (app UI) is English");
  });

  it("lists every selected language for 'is any of'", () => {
    const filter: ListFilter = {
      field: "language",
      operator: "in",
      value: ["en", "sv"],
    };
    expect(describeFilter(filter)).toBe("Language (app UI) is any of English, Swedish");
  });
});
