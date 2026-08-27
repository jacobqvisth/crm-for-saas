import { describe, expect, it } from "vitest";
import { codeTokensIn, isPossibleCode, judgeKeyword } from "./keyword-audit";

describe("code shape", () => {
  it("accepts the second characters the standard allows", () => {
    for (const code of ["P0420", "P1525", "P2002", "P3000", "U0416"]) {
      expect(isPossibleCode(code), code).toBe(true);
    }
  });

  it("rejects the ones no vehicle emits", () => {
    for (const code of ["P8000", "P5200", "P9982", "P4000", "P7500"]) {
      expect(isPossibleCode(code), code).toBe(false);
    }
  });

  it("finds codes inside a longer keyword", () => {
    expect(codeTokensIn("audi p0299")).toEqual(["P0299"]);
    expect(codeTokensIn("chevy malibu 2016 code p0171")).toEqual(["P0171"]);
    expect(codeTokensIn("obd software")).toEqual([]);
  });
});

describe("what may be removed", () => {
  it("removes an enumerated code that never served", () => {
    const verdict = judgeKeyword("p8000", 0);
    expect(verdict.removable).toBe(true);
  });

  it("keeps anything containing a real code", () => {
    expect(judgeKeyword("audi p0299", 0).removable).toBe(false);
  });

  it("keeps a keyword with no code in it at all", () => {
    expect(judgeKeyword("obd software for workshops", 0).removable).toBe(false);
  });

  it("keeps truck models that merely look like chassis codes", () => {
    // C4500 is a Chevrolet, not a fault code. Reading it as one is what made
    // the first version of this audit overcount by 56 keywords, and those
    // keywords had served real impressions.
    for (const keyword of [
      "chevrolet c4500",
      "gmc c5500",
      "chevy c7500",
      "gmc c8500",
    ]) {
      const verdict = judgeKeyword(keyword, 0);
      expect(verdict.removable, keyword).toBe(false);
      expect(verdict.reason).toContain("model designation");
    }
  });

  it("keeps anything that has ever served, whatever its shape", () => {
    // Evidence beats inference. If it matched a real search once, the shape
    // argument is wrong about it.
    const verdict = judgeKeyword("p8801", 3);
    expect(verdict.removable).toBe(false);
    expect(verdict.reason).toContain("impression");
  });

  it("is unmoved by case", () => {
    expect(judgeKeyword("P8000", 0).removable).toBe(true);
    expect(judgeKeyword("p8000", 0).removable).toBe(true);
  });
});
