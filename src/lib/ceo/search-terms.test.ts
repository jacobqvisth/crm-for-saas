import { describe, expect, it } from "vitest";
import type { DiagnosticListItem } from "@/lib/ceo/data/diagnostics";
import { analyseSearchTerms } from "@/lib/ceo/search-terms";

let counter = 0;

/**
 * Minimal DiagnosticListItem — only the fields the analyser reads.
 */
function item(
  description: string | null,
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
    workshopName: "Workshop",
    country: "SE",
    language: "sv",
    isInternal: false,
    carMake: "VOLVO",
    carModel: "V70",
    carYear: 2014,
    dtcs: [],
    symptoms: [],
    description,
    mileage: null,
    aiModel: null,
    diagCost: 0,
    numCauses: 0,
    hasChat: false,
    hasInvoice: false,
    topCause: null,
    causes: [],
    ...overrides,
  };
}

function bucket(buckets: { key: string; count: number }[], key: string) {
  return buckets.find((entry) => entry.key === key)?.count ?? 0;
}

describe("analyseSearchTerms", () => {
  it("counts only entries that actually have description text", () => {
    const result = analyseSearchTerms([
      item("motorlampa lyser"),
      item(""),
      item("   "),
      item(null),
    ]);
    expect(result.totals.diagnostics).toBe(4);
    expect(result.totals.described).toBe(1);
    expect(result.totals.coverage).toBeCloseTo(0.25);
  });

  it("labels the common Swedish and English complaints", () => {
    const result = analyseSearchTerms([
      item("motorlampa lyser"),
      item("check engine light on"),
      item("startar inte"),
      item("crank no start no injector pulse"),
      item("engine misfire"),
      item("bilen hackar och rycker"),
      item("går i limpmode vid 100% belastning"),
      item("engine is running rough, lack of power"),
    ]);
    expect(bucket(result.complaints, "warning-lamp")).toBe(2);
    expect(bucket(result.complaints, "wont-start")).toBe(2);
    expect(bucket(result.complaints, "rough-running")).toBe(3);
    expect(bucket(result.complaints, "power-loss")).toBe(2);
  });

  it("matches complaints written in the long-tail languages", () => {
    const result = analyseSearchTerms([
      item("la peste 3.000 rpm apare martor la bord si motorul pierde putere", {
        language: "ro",
        country: "RO",
      }),
      item("auto straciło moc i głośniej chodziło", {
        language: "pl",
        country: "PL",
      }),
      item("sorveglianza avviamento: performance o operazione non conforme", {
        language: "it",
        country: "IT",
      }),
    ]);
    expect(bucket(result.complaints, "warning-lamp")).toBe(1);
    expect(bucket(result.complaints, "power-loss")).toBe(2);
  });

  it("flags prior repair work and the no-change follow-up", () => {
    const result = analyseSearchTerms([
      item(
        "virvelspjäll samt aktuator är bytt, felmeddelande återkom samt att dpf täppte igen",
      ),
      item("we replaced the fuel filter and it ran for 100 miles with no joy"),
      item("vymeneny zadny chladic egr pri motorovej stene - bez zmeny", {
        language: "sk",
        country: "SK",
      }),
      item("motorlampa lyser"),
    ]);
    expect(bucket(result.phrasing, "prior-work")).toBe(3);
    expect(bucket(result.phrasing, "prior-work-no-change")).toBe(3);
  });

  it("detects quoted fault codes, measurements and stated absence of codes", () => {
    const result = analyseSearchTerms([
      item("p2002, pemanent fel, vi har bytt båda dpf tryckgivarna"),
      item("now p0102-00 code and p0193-17 codes which are permanently on"),
      item("bränsletryck 39bar på tom gång"),
      item("inga felkoder, bilen kom bärgad"),
    ]);
    expect(bucket(result.phrasing, "quotes-code")).toBe(2);
    expect(bucket(result.phrasing, "measurements")).toBe(1);
    expect(bucket(result.phrasing, "no-codes")).toBe(1);
    expect(bucket(result.phrasing, "towed-in")).toBe(1);
    expect(result.quotedCodes.map((row) => row.term)).toContain("P0193");
  });

  it("does not treat \\s? fragments as literal question marks", () => {
    // Regression guard: escaping every "?" in the pattern sources broke
    // `\d+\s?bar` and friends, silently zeroing the measurements bucket.
    const result = analyseSearchTerms([item("mätte 12 volt vid givaren")]);
    expect(bucket(result.phrasing, "measurements")).toBe(1);
  });

  it("separates a direct question from a plain symptom", () => {
    const result = analyseSearchTerms([
      item("vad kan det vara för fel på abs-systemet?"),
      item("abs lampa lyser"),
    ]);
    expect(bucket(result.phrasing, "asks-question")).toBe(1);
  });

  it("assigns vehicle systems, allowing more than one per entry", () => {
    const result = analyseSearchTerms([
      item("felkoder på egr och dpf, spridare bytta"),
      item("går ej att utföra grundinställning på mekatronik"),
      item("ac kompressor ur funktion"),
      item("airbag fel"),
    ]);
    expect(bucket(result.systems, "emissions")).toBe(1);
    expect(bucket(result.systems, "fuel-injection")).toBe(1);
    expect(bucket(result.systems, "transmission")).toBe(1);
    expect(bucket(result.systems, "climate")).toBe(1);
    expect(bucket(result.systems, "safety-srs")).toBe(1);
  });

  it("bands entries by length with no overlap and no gaps", () => {
    const result = analyseSearchTerms([
      item("motorlampa"),
      item("bilen startar inte alls"),
      item("a".repeat(40) + " b c d"),
      item("a".repeat(150) + " b c d"),
      item("a".repeat(400) + " b c d"),
    ]);
    const total = result.lengthBands.reduce((sum, band) => sum + band.count, 0);
    expect(total).toBe(result.totals.described);
    expect(bucket(result.lengthBands, "keyword")).toBe(1);
    expect(bucket(result.lengthBands, "narrative")).toBe(1);
  });

  it("groups repeated verbatims regardless of case and trailing punctuation", () => {
    const result = analyseSearchTerms([
      item("Motorlampa lyser"),
      item("motorlampa lyser."),
      item("motorlampa  lyser"),
      item("startar inte"),
    ]);
    expect(result.verbatims[0].count).toBe(3);
    expect(result.totals.distinctTexts).toBe(2);
    expect(result.totals.repeatedTexts).toBe(1);
  });

  it("keeps stopwords and bare numbers out of the term frequency lists", () => {
    const result = analyseSearchTerms([
      item("bilen har fel och det lyser 123 motorlampa"),
      item("bilen har fel och det lyser 123 motorlampa"),
    ]);
    const terms = result.unigrams.map((row) => row.term);
    expect(terms).toContain("motorlampa");
    expect(terms).not.toContain("och");
    expect(terms).not.toContain("bilen");
    expect(terms).not.toContain("123");
  });

  it("flags obvious test entries", () => {
    const result = analyseSearchTerms([
      item("test"),
      item("asdasd"),
      item("123"),
      item("..."),
      item("motorlampa lyser"),
    ]);
    expect(bucket(result.phrasing, "test-entry")).toBe(4);
  });

  it("reports language mix and monthly coverage", () => {
    const result = analyseSearchTerms([
      item("motorlampa lyser", { createdAt: "2026-06-04T10:00:00.000Z" }),
      item("check engine light", {
        language: "en",
        country: "GB",
        createdAt: "2026-07-04T10:00:00.000Z",
      }),
      item(null, { createdAt: "2026-07-05T10:00:00.000Z" }),
    ]);
    expect(result.languages[0].entries).toBe(1);
    expect(result.languages.map((row) => row.language).sort()).toEqual([
      "en",
      "sv",
    ]);
    const july = result.monthly.find((row) => row.month === "2026-07");
    expect(july).toMatchObject({ total: 2, described: 1 });
    expect(july?.coverage).toBeCloseTo(0.5);
  });

  it("collects text that matched no complaint category", () => {
    const result = analyseSearchTerms([
      item("motorlampa lyser"),
      item("volvo v70 årsmodell tvåtusenfjorton"),
    ]);
    expect(result.uncategorised.count).toBe(1);
    expect(result.uncategorised.examples[0].text).toContain("årsmodell");
  });

  it("separates pasted code definitions from code-only entries", () => {
    const result = analyseSearchTerms([
      item("Fuel Rail Pressure Sensor Circuit Range/Performance"),
      item("Intake air temperature (IAT) sensor circuit high input"),
      item("p0017,p0014,p0089"),
      item("P0741"),
      item("Dtc code p0647"),
      item("Fehlercode B1161"),
    ]);
    expect(bucket(result.complaints, "code-definition")).toBe(2);
    expect(bucket(result.complaints, "code-only")).toBe(4);
  });

  it("recognises spec lookups, planned jobs and inspection prep", () => {
    const result = analyseSearchTerms([
      item("step by step procedure to replace the air conditioning compressor"),
      item("Skall göra en oljeservice, hur mycket olja ryms?"),
      item("what are the colors of the wires going into the blower motor"),
      item("Byte av värmeväxlare"),
      item("Förhög co halt vid besiktning har bytt tändstift luftfilter och olja"),
    ]);
    expect(bucket(result.complaints, "info-lookup")).toBe(3);
    expect(bucket(result.complaints, "planned-job")).toBe(2);
    expect(bucket(result.complaints, "inspection")).toBe(1);
  });

  it("treats general vibration as noise and idle vibration as both", () => {
    const result = analyseSearchTerms([
      item("La macchina vibra dopo essersi arrestata"),
      item("vibbrationer på tomgång"),
    ]);
    // Both are vibration complaints; only the idle one also reads as a misfire.
    expect(bucket(result.complaints, "noise-vibration")).toBe(2);
    expect(bucket(result.complaints, "rough-running")).toBe(1);
  });
});
