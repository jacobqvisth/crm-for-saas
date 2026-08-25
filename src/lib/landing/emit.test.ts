import { describe, expect, it } from "vitest";
import type { DtcAnalysis, DtcCodeRow } from "@/lib/ceo/dtc/analyse";
import { buildFaultCodeBundle, validateBundle } from "./emit";
import { buildLandingPlan } from "./plan";

function codeRow(over: Partial<DtcCodeRow> & { base: string }): DtcCodeRow {
  return {
    name: null,
    scope: "generic",
    familyKey: "misc",
    familyLabel: "Other",
    entries: 1,
    share: 0,
    distinctWorkshops: 1,
    topMake: null,
    topMakeEntries: 0,
    rawVariants: [],
    ftbs: [],
    chatRate: 0,
    avgCauses: 0,
    codeOnlyShare: 0,
    firstSeen: null,
    lastSeen: null,
    examples: [],
    ...over,
  };
}

function analysisWith(
  rows: DtcCodeRow[],
  pairs: DtcAnalysis["pairs"] = [],
): DtcAnalysis {
  return { topCodes: rows, pairs, makes: [] } as unknown as DtcAnalysis;
}

function bundleFrom(rows: DtcCodeRow[], pairs: DtcAnalysis["pairs"] = []) {
  const analysis = analysisWith(rows, pairs);
  return buildFaultCodeBundle(
    buildLandingPlan(analysis),
    analysis,
    "2026-08-25",
  );
}

describe("the emitted bundle", () => {
  it("never emits a page for a manufacturer-specific code", () => {
    // The single most important invariant in the programme, asserted at the
    // last point before anything reaches disk.
    const bundle = bundleFrom([
      codeRow({ base: "P1525", scope: "manufacturer", entries: 300 }),
    ]);
    expect(bundle.pages.some((page) => page.code === "P1525")).toBe(false);
    expect(bundle.pages.every((page) => page.scope === "generic")).toBe(true);
  });

  it("passes its own validation", () => {
    const bundle = bundleFrom([
      codeRow({
        base: "P0420",
        name: "Catalyst system efficiency below threshold, bank 1",
        entries: 31,
        distinctWorkshops: 20,
        familyKey: "catalyst",
        familyLabel: "Catalyst and emissions",
      }),
      codeRow({ base: "P1525", scope: "manufacturer", entries: 9 }),
    ]);
    expect(validateBundle(bundle)).toEqual([]);
  });

  it("gives every page a family hub to link to", () => {
    const bundle = bundleFrom([codeRow({ base: "P0420", entries: 31 })]);
    const hubPaths = new Set(bundle.families.map((family) => family.path));
    for (const page of bundle.pages) {
      expect(hubPaths.has(page.familyPath), page.code).toBe(true);
    }
  });

  it("keeps long dashes out of titles and descriptions", () => {
    // Generated text, and the no-long-dash rule applies to it like any other.
    const bundle = bundleFrom([codeRow({ base: "P0420", entries: 31 })]);
    for (const page of bundle.pages) {
      expect(page.meta.title).not.toMatch(/[—–]/);
      expect(page.meta.description).not.toMatch(/[—–]/);
    }
  });

  it("leads the title with the code, because that is the query", () => {
    const bundle = bundleFrom([
      codeRow({ base: "P0420", name: "Catalyst efficiency", entries: 31 }),
    ]);
    const page = bundle.pages.find((row) => row.code === "P0420");
    expect(page?.meta.title.startsWith("P0420: ")).toBe(true);
  });

  it("puts real evidence in the description when there is any", () => {
    const bundle = bundleFrom([
      codeRow({
        base: "P0420",
        name: "Catalyst efficiency",
        entries: 31,
        distinctWorkshops: 20,
      }),
    ]);
    const page = bundle.pages.find((row) => row.code === "P0420");
    expect(page?.meta.description).toContain("31 real diagnostics");
    expect(page?.meta.description).toContain("20 workshops");
  });

  it("says plainly when a code is not individually documented", () => {
    const bundle = bundleFrom([codeRow({ base: "P2ZZZ", entries: 4 })]);
    const page = bundle.pages.find((row) => row.code === "P2ZZZ");
    expect(page?.name).toBeNull();
    expect(page?.meta.description).toContain("not individually documented");
  });

  it("carries companion codes strongest association first", () => {
    const bundle = bundleFrom(
      [
        codeRow({ base: "P0562", entries: 15, name: "System voltage low" }),
        codeRow({ base: "U0416", entries: 12 }),
        codeRow({ base: "P0100", entries: 15 }),
      ],
      [
        {
          a: "P0562",
          b: "P0100",
          aName: null,
          bName: null,
          together: 3,
          aTotal: 15,
          bTotal: 15,
          lift: 2.1,
          confidence: 0.2,
          sameFamily: false,
        },
        {
          a: "P0562",
          b: "U0416",
          aName: null,
          bName: null,
          together: 11,
          aTotal: 15,
          bTotal: 12,
          lift: 9.4,
          confidence: 0.9,
          sameFamily: false,
        },
      ],
    );
    const page = bundle.pages.find((row) => row.code === "P0562");
    expect(page?.companions[0]?.code).toBe("U0416");
    expect(page?.companions[0]?.lift).toBe(9.4);
  });

  it("never links a companion that has no page", () => {
    // Co-occurrence is computed over every code we have seen, including the
    // manufacturer-specific ones that deliberately never get a page. Before
    // this was guarded, the exclusion rule leaked back out as broken links.
    const bundle = bundleFrom(
      [
        codeRow({ base: "P0299", name: "Turbo underboost", entries: 55 }),
        codeRow({ base: "P1258", scope: "manufacturer", entries: 6 }),
      ],
      [
        {
          a: "P0299",
          b: "P1258",
          aName: null,
          bName: null,
          together: 4,
          aTotal: 55,
          bTotal: 6,
          lift: 8.1,
          confidence: 0.6,
          sameFamily: false,
        },
      ],
    );
    const page = bundle.pages.find((row) => row.code === "P0299");
    const companion = page?.companions.find((c) => c.code === "P1258");
    // The association is real and stays. Only the link is withheld.
    expect(companion).toBeDefined();
    expect(companion?.hasPage).toBe(false);
    expect(companion?.scope).toBe("manufacturer");
    expect(validateBundle(bundle)).toEqual([]);
  });

  it("catches a companion that wrongly claims a page", () => {
    const bundle = bundleFrom(
      [
        codeRow({ base: "P0299", name: "Turbo underboost", entries: 55 }),
        codeRow({ base: "P1258", scope: "manufacturer", entries: 6 }),
      ],
      [
        {
          a: "P0299",
          b: "P1258",
          aName: null,
          bName: null,
          together: 4,
          aTotal: 55,
          bTotal: 6,
          lift: 8.1,
          confidence: 0.6,
          sameFamily: false,
        },
      ],
    );
    bundle.pages.find((row) => row.code === "P0299")!.companions[0].hasPage =
      true;
    expect(validateBundle(bundle).join(" ")).toContain("which has no page");
  });

  it("lists manufacturer codes on the family hub instead of dropping them", () => {
    // They get no page, but pretending we have never seen them would be its
    // own kind of dishonest.
    const bundle = bundleFrom([
      codeRow({
        base: "P0420",
        name: "Catalyst efficiency",
        entries: 31,
        familyKey: "catalyst",
        familyLabel: "Catalyst and emissions",
      }),
      codeRow({
        base: "P1420",
        scope: "manufacturer",
        entries: 9,
        familyKey: "catalyst",
        familyLabel: "Catalyst and emissions",
      }),
    ]);
    const hub = bundle.families.find((family) => family.key === "catalyst");
    expect(hub?.manufacturerCodes).toContain("P1420");
  });

  it("catches a bad bundle rather than writing it", () => {
    const bundle = bundleFrom([codeRow({ base: "P0420", entries: 31 })]);
    bundle.pages[0].slug = "wrong-slug";
    expect(validateBundle(bundle).join(" ")).toContain("slug mismatch");
  });
});
