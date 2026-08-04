import { describe, expect, it } from "vitest";
import type { DiagnosticListItem } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "./analyse";
import { codeName } from "./dictionary";
import { baseCodeScope, baseCodeValue, parseDtc, parseDtcList } from "./parse";
import { classifyFamily, ftbFamily, ftbName, powertrainSubsystem } from "./taxonomy";

let counter = 0;

/** Minimal DiagnosticListItem — only the fields the analyser reads. */
function item(
  dtcs: string[],
  overrides: Partial<DiagnosticListItem> = {},
): DiagnosticListItem {
  counter += 1;
  return {
    diagnosticId: `d${counter}`,
    status: "completed",
    createdAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
    username: null,
    userName: null,
    userRole: null,
    workshopId: "w1",
    workshopName: "Workshop One",
    country: "SE",
    language: "sv",
    isInternal: false,
    carMake: "Volvo",
    carModel: "V70",
    carYear: 2014,
    dtcs,
    symptoms: [],
    description: "motorlampa lyser",
    mileage: null,
    aiModel: "claude",
    diagCost: 0,
    numCauses: 4,
    hasChat: false,
    hasInvoice: false,
    topCause: null,
    causes: [],
    ...overrides,
  };
}

describe("parseDtc", () => {
  it("reads a plain 5-character SAE code", () => {
    const parsed = parseDtc("P0299");
    expect(parsed.kind).toBe("sae");
    expect(parsed.base).toBe("P0299");
    expect(parsed.ftb).toBeNull();
    expect(parsed.system).toBe("P");
    expect(parsed.defects).toEqual([]);
  });

  it("splits a failure type byte off the base code", () => {
    const parsed = parseDtc("P029900");
    expect(parsed.kind).toBe("sae-ftb");
    expect(parsed.base).toBe("P0299");
    expect(parsed.ftb).toBe("00");
  });

  it("collapses the two prod formats of one fault onto the same base", () => {
    expect(parseDtc("P0299").base).toBe(parseDtc("P029900").base);
    expect(parseDtc("P0017").base).toBe(parseDtc("P001792").base);
  });

  it("keeps hex letters in the base code", () => {
    const parsed = parseDtc("P2B2A7A");
    expect(parsed.base).toBe("P2B2A");
    expect(parsed.ftb).toBe("7A");
  });

  it("repairs the letter O typed for a zero", () => {
    const parsed = parseDtc("POO12");
    expect(parsed.base).toBe("P0012");
    expect(parsed.defects).toContain("letter-o-for-zero");
  });

  it("repairs letter O inside a code that carries a failure type byte", () => {
    const parsed = parseDtc("POCEE2A");
    expect(parsed.kind).toBe("sae-ftb");
    expect(parsed.base).toBe("P0CEE");
    expect(parsed.ftb).toBe("2A");
  });

  it("recovers the base code when the failure type byte is cut short", () => {
    const parsed = parseDtc("P02990");
    expect(parsed.kind).toBe("sae");
    expect(parsed.base).toBe("P0299");
    expect(parsed.ftb).toBeNull();
    expect(parsed.defects).toContain("truncated-failure-type");
  });

  it("upper-cases and strips separators", () => {
    const parsed = parseDtc(" p0-299 ");
    expect(parsed.base).toBe("P0299");
    expect(parsed.defects).toContain("lowercase");
    expect(parsed.defects).toContain("separators");
  });

  it("keeps raw manufacturer hex as its own kind rather than forcing an SAE code", () => {
    const parsed = parseDtc("0029D0");
    expect(parsed.kind).toBe("manufacturer-hex");
    expect(parsed.base).toBeNull();
  });

  it("recognises a Renault DF code as manufacturer-native", () => {
    expect(parseDtc("DF175").kind).toBe("manufacturer-native");
  });

  it("rejects a second character outside the 0-3 the standard allows", () => {
    // P8700 / P6662 appear in prod but are not valid SAE codes.
    expect(parseDtc("P8700").kind).toBe("unparseable");
    expect(parseDtc("P6662").kind).toBe("unparseable");
  });

  it("rejects a non-hex character in the code body", () => {
    const parsed = parseDtc("U120R87");
    expect(parsed.kind).toBe("unparseable");
    expect(parsed.defects).toContain("not-a-code");
  });

  it("drops blank entries", () => {
    expect(parseDtcList(["P0299", "", "  "])).toHaveLength(1);
  });
});

describe("baseCodeValue", () => {
  it("orders codes the way SAE ranges assume", () => {
    expect(baseCodeValue("P0299")).toBeLessThan(baseCodeValue("P0300"));
    expect(baseCodeValue("P09FF")).toBeLessThan(baseCodeValue("P0A00"));
  });
});

describe("baseCodeScope", () => {
  it("treats second character 0 and 2 as generic", () => {
    expect(baseCodeScope("P0299")).toBe("generic");
    expect(baseCodeScope("P2002")).toBe("generic");
  });

  it("treats second character 1 and 3 as manufacturer-specific", () => {
    expect(baseCodeScope("P1525")).toBe("manufacturer");
    expect(baseCodeScope("P3008")).toBe("manufacturer");
  });
});

describe("classifyFamily", () => {
  it("puts the top prod codes in the family a technician would expect", () => {
    expect(classifyFamily("P0299").key).toBe("turbo-boost");
    expect(classifyFamily("P0420").key).toBe("catalyst");
    expect(classifyFamily("P2002").key).toBe("dpf");
    expect(classifyFamily("P0171").key).toBe("fuel-trim");
    expect(classifyFamily("P0017").key).toBe("timing-vvt");
    expect(classifyFamily("P0303").key).toBe("misfire");
    expect(classifyFamily("P0087").key).toBe("fuel-pressure");
    expect(classifyFamily("P0562").key).toBe("charging");
    expect(classifyFamily("U0416").key).toBe("network");
    expect(classifyFamily("P0201").key).toBe("injector");
    expect(classifyFamily("P0675").key).toBe("glow-plug");
    expect(classifyFamily("P0751").key).toBe("transmission");
    expect(classifyFamily("P0101").key).toBe("air-intake");
  });

  it("does not let a broad range swallow a turbo code into lambda", () => {
    // Regression: an over-wide P2195-P2A0F lambda range captured P2563.
    expect(classifyFamily("P2563").key).toBe("turbo-boost");
  });

  it("does not let the exhaust range swallow the fuel level sensor", () => {
    expect(classifyFamily("P0461").key).toBe("evap");
    expect(classifyFamily("P0471").key).toBe("exhaust-pressure");
  });

  it("keeps glow plug codes out of the ECU range", () => {
    expect(classifyFamily("P0671").key).toBe("glow-plug");
    expect(classifyFamily("P0606").key).toBe("ecu-internal");
  });

  it("separates DPF from secondary air in the P24xx block", () => {
    expect(classifyFamily("P2452").key).toBe("dpf");
    expect(classifyFamily("P2442").key).not.toBe("dpf");
  });

  it("classifies every code into exactly one family", () => {
    const codes = ["P0299", "P0420", "U0416", "B1267", "C0561", "P0300"];
    for (const code of codes) {
      expect(classifyFamily(code).key).toBeTruthy();
    }
  });

  it("groups manufacturer-specific powertrain codes rather than naming or dropping them", () => {
    // P1xxx/P3xxx mean different things per make, so they get a deliberately
    // vague family instead of a guessed one — but they must not fall out as
    // "unclassified", which would be ~30% of all code instances in prod.
    expect(classifyFamily("P1525").key).toBe("powertrain-manufacturer");
    expect(classifyFamily("P3008").key).toBe("powertrain-manufacturer");
  });

  it("still lets a specific rule win over the manufacturer catch-all", () => {
    expect(classifyFamily("P0299").key).toBe("turbo-boost");
    expect(classifyFamily("P2002").key).toBe("dpf");
  });
});

describe("powertrainSubsystem", () => {
  it("uses the standard's own third-character grouping", () => {
    expect(powertrainSubsystem("P0303")?.key).toBe("ignition");
    expect(powertrainSubsystem("P0751")?.key).toBe("transmission");
    expect(powertrainSubsystem("P0A0F")?.key).toBe("hybrid");
  });

  it("returns nothing for non-powertrain codes", () => {
    expect(powertrainSubsystem("U0416")).toBeNull();
  });
});

describe("failure type bytes", () => {
  it("names the bytes that actually appear in prod", () => {
    expect(ftbName("00")).toMatch(/no sub-type/i);
    expect(ftbName("13")).toMatch(/open/i);
    expect(ftbName("92")).toMatch(/performance/i);
  });

  it("groups an unnamed byte by its high nibble", () => {
    expect(ftbFamily("1B").key).toBe("circuit");
    expect(ftbFamily("2A").key).toBe("signal");
    expect(ftbFamily("77").key).toBe("mechanical");
  });

  it("labels manufacturer-defined bytes instead of inventing a meaning", () => {
    expect(ftbFamily("FA").key).toBe("manufacturer");
    expect(ftbName("FA")).toBeNull();
  });
});

describe("dictionary", () => {
  it("names generic codes", () => {
    expect(codeName("P0299")).toMatch(/underboost/i);
    expect(codeName("P0420")).toMatch(/catalyst/i);
    expect(codeName("U0416")).toMatch(/vehicle dynamics/i);
  });

  it("has no entry for manufacturer-specific codes", () => {
    expect(codeName("P1525")).toBeNull();
    expect(codeName("B1267")).toBeNull();
  });
});

describe("analyseDtcCodes", () => {
  it("counts the two formats of one fault as a single code", () => {
    const analysis = analyseDtcCodes([item(["P0299"]), item(["P029900"])]);
    expect(analysis.totals.distinctBaseCodes).toBe(1);
    expect(analysis.topCodes[0].base).toBe("P0299");
    expect(analysis.topCodes[0].entries).toBe(2);
    expect(analysis.topCodes[0].rawVariants).toEqual(["P0299", "P029900"]);
  });

  it("counts a repeated base code once per diagnostic", () => {
    // Prod has sessions carrying the same base twice under different FTBs.
    const analysis = analyseDtcCodes([item(["P008700", "P008751"])]);
    expect(analysis.topCodes[0].entries).toBe(1);
    expect(analysis.topCodes[0].ftbs).toEqual(["00", "51"]);
    expect(analysis.totals.codeOccurrences).toBe(1);
    expect(analysis.totals.rawEntries).toBe(2);
  });

  it("reports coverage and the code-only share", () => {
    const analysis = analyseDtcCodes([
      item(["P0299"], { description: null }),
      item(["P0420"], { description: "lampa lyser" }),
      item([], { description: "bilen startar inte" }),
    ]);
    expect(analysis.totals.diagnostics).toBe(3);
    expect(analysis.totals.withCodes).toBe(2);
    expect(analysis.totals.coverage).toBeCloseTo(2 / 3);
    expect(analysis.totals.codeOnlyEntries).toBe(1);
    expect(analysis.totals.codeOnlyShare).toBeCloseTo(0.5);
  });

  it("finds co-occurring pairs and scores association above chance", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => item(["P0201", "P0204"])),
      item(["P0299"]),
      item(["P0420"]),
    ];
    const analysis = analyseDtcCodes(entries, { minPairSupport: 3 });
    expect(analysis.pairs).toHaveLength(1);
    const [pair] = analysis.pairs;
    expect([pair.a, pair.b]).toEqual(["P0201", "P0204"]);
    expect(pair.together).toBe(5);
    // Both codes only ever appear together, so confidence is total and lift is
    // well above 1.
    expect(pair.confidence).toBe(1);
    expect(pair.lift).toBeGreaterThan(1);
    expect(pair.sameFamily).toBe(true);
  });

  it("respects the minimum pair support", () => {
    const analysis = analyseDtcCodes([item(["P0201", "P0204"])], {
      minPairSupport: 3,
    });
    expect(analysis.pairs).toHaveLength(0);
  });

  it("groups exact repeated multi-code fingerprints", () => {
    const analysis = analyseDtcCodes([
      item(["P0562", "U0416"]),
      item(["U0416", "P0562"]),
      item(["P0299"]),
    ]);
    expect(analysis.sets).toHaveLength(1);
    expect(analysis.sets[0].codes).toEqual(["P0562", "U0416"]);
    expect(analysis.sets[0].count).toBe(2);
  });

  it("rolls codes up into functional families", () => {
    const analysis = analyseDtcCodes([
      item(["P0300"]),
      item(["P0301"]),
      item(["P0420"]),
    ]);
    const misfire = analysis.families.find((row) => row.key === "misfire");
    expect(misfire?.entries).toBe(2);
    expect(misfire?.distinctCodes).toBe(2);
    const catalyst = analysis.families.find((row) => row.key === "catalyst");
    expect(catalyst?.entries).toBe(1);
  });

  it("breaks down failure type bytes and their families", () => {
    const analysis = analyseDtcCodes([
      item(["P029900"]),
      item(["P001792"]),
      item(["P0299"]),
    ]);
    expect(analysis.totals.withFtb).toBe(2);
    expect(analysis.ftbs.map((row) => row.ftb).sort()).toEqual(["00", "92"]);
    const performance = analysis.ftbFamilies.find(
      (row) => row.key === "performance",
    );
    expect(performance?.occurrences).toBe(1);
  });

  it("collapses make casing so one brand is one row", () => {
    const analysis = analyseDtcCodes(
      [
        item(["P0299"], { carMake: "VOLVO" }),
        item(["P0420"], { carMake: "Volvo" }),
        item(["P0171"], { carMake: "MERCEDES" }),
        item(["P0172"], { carMake: "Mercedes-Benz" }),
      ],
      { minMakeEntries: 1 },
    );
    const makes = analysis.makes.map((row) => row.make).sort();
    expect(makes).toEqual(["Mercedes-Benz", "Volvo"]);
    expect(analysis.makes.every((row) => row.entries === 2)).toBe(true);
  });

  it("bands diagnostics by how many codes they carry", () => {
    const analysis = analyseDtcCodes([
      item([]),
      item(["P0299"]),
      item(["P0299", "P0420"]),
      item(["P0299", "P0420", "P0171", "P0172", "P0300", "P0301"]),
    ]);
    expect(analysis.countBands.map((band) => band.key)).toEqual([
      "0",
      "1",
      "2",
      "6+",
    ]);
    expect(analysis.countBands.find((b) => b.key === "6+")?.entries).toBe(1);
  });

  it("separates generic from manufacturer-specific codes", () => {
    const analysis = analyseDtcCodes([item(["P0299"]), item(["P1525"])]);
    const generic = analysis.scopes.find((row) => row.key === "generic");
    const manufacturer = analysis.scopes.find(
      (row) => row.key === "manufacturer",
    );
    expect(generic?.entries).toBe(1);
    expect(manufacturer?.entries).toBe(1);
  });

  it("collects data-quality defects with examples", () => {
    const analysis = analyseDtcCodes([item(["POO12"]), item(["U120R87"])]);
    const typo = analysis.defects.find(
      (row) => row.defect === "letter-o-for-zero",
    );
    expect(typo?.occurrences).toBe(1);
    expect(typo?.examples[0]).toEqual({ raw: "POO12", normalized: "P0012" });
    expect(analysis.unparseable[0].raw).toBe("U120R87");
    expect(analysis.totals.noSaeCodeEntries).toBe(1);
  });

  it("keeps manufacturer hex out of the code counts but still reports it", () => {
    const analysis = analyseDtcCodes([
      item(["0029D0"], { carMake: "BMW" }),
      item(["P0299"]),
    ]);
    expect(analysis.totals.distinctBaseCodes).toBe(1);
    expect(analysis.manufacturerHex[0].raw).toBe("0029D0");
    expect(analysis.manufacturerHex[0].makes).toEqual(["BMW"]);
  });

  it("measures workshop spread and concentration", () => {
    const spreadOut = Array.from({ length: 4 }, (_, index) =>
      item(["P0299"], { workshopId: `w${index}`, workshopName: `Shop ${index}` }),
    );
    const concentrated = Array.from({ length: 4 }, () =>
      item(["P0420"], { workshopId: "solo", workshopName: "Solo Shop" }),
    );
    const analysis = analyseDtcCodes([...spreadOut, ...concentrated], {
      minSpreadEntries: 4,
    });
    expect(analysis.widestSpread[0].base).toBe("P0299");
    expect(analysis.widestSpread[0].distinctWorkshops).toBe(4);
    const solo = analysis.mostConcentrated.find((row) => row.base === "P0420");
    expect(solo?.topWorkshopShare).toBe(1);
    expect(solo?.topWorkshopName).toBe("Solo Shop");
  });

  it("compares a recent window against the one before it", () => {
    const recent = Array.from({ length: 4 }, () =>
      item(["P0299"], { createdAt: "2026-07-20T10:00:00.000Z" }),
    );
    const older = Array.from({ length: 5 }, () =>
      item(["P0420"], { createdAt: "2026-04-01T10:00:00.000Z" }),
    );
    const analysis = analyseDtcCodes([...recent, ...older]);
    expect(analysis.rising[0].base).toBe("P0299");
    expect(analysis.rising[0].isNew).toBe(true);
    expect(analysis.trendWindowDays).toBe(60);
  });

  it("builds a monthly series", () => {
    const analysis = analyseDtcCodes([
      item(["P0299"], { createdAt: "2026-06-10T10:00:00.000Z" }),
      item([], { createdAt: "2026-06-11T10:00:00.000Z" }),
      item(["P0420"], { createdAt: "2026-07-02T10:00:00.000Z" }),
    ]);
    expect(analysis.monthly.map((point) => point.month)).toEqual([
      "2026-06",
      "2026-07",
    ]);
    expect(analysis.monthly[0].coverage).toBeCloseTo(0.5);
  });

  it("handles an empty list without dividing by zero", () => {
    const analysis = analyseDtcCodes([]);
    expect(analysis.totals.diagnostics).toBe(0);
    expect(analysis.totals.coverage).toBe(0);
    expect(analysis.totals.avgCodesPerEntry).toBe(0);
    expect(analysis.topCodes).toEqual([]);
    expect(analysis.pairs).toEqual([]);
  });
});
