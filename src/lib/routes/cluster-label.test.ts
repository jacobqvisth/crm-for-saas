import { describe, expect, it } from "vitest";
import { decorateLabelWithMode, labelForStops, type LabelStop } from "./cluster-label";

function s(city: string | null, lat = 59.33, lng = 18.07): LabelStop {
  return { city, lat, lng };
}

describe("labelForStops", () => {
  it("8/10 stops in Solna → 'Solna'", () => {
    const stops: LabelStop[] = [
      ...Array(8).fill(0).map(() => s("Solna")),
      s("Sundbyberg"),
      s("Bromma"),
    ];
    expect(labelForStops(stops, 59.33, 18.07)).toBe("Solna");
  });

  it("6 in Solna + 4 in Sundbyberg → 'Solna · Sundbyberg'", () => {
    const stops: LabelStop[] = [
      ...Array(6).fill(0).map(() => s("Solna")),
      ...Array(4).fill(0).map(() => s("Sundbyberg")),
    ];
    expect(labelForStops(stops, 59.33, 18.07)).toBe("Solna · Sundbyberg");
  });

  it("4 in Solna + 3 in Sundbyberg + 3 in Bromma → 'Solna · Sundbyberg · Bromma'", () => {
    const stops: LabelStop[] = [
      ...Array(4).fill(0).map(() => s("Solna")),
      ...Array(3).fill(0).map(() => s("Sundbyberg")),
      ...Array(3).fill(0).map(() => s("Bromma")),
    ];
    expect(labelForStops(stops, 59.33, 18.07)).toBe("Solna · Sundbyberg · Bromma");
  });

  it("very mixed → top 2 + ellipsis", () => {
    const stops: LabelStop[] = [
      s("Solna"),
      s("Solna"),
      s("Sundbyberg"),
      s("Sundbyberg"),
      s("Bromma"),
      s("Täby"),
      s("Lidingö"),
      s("Nacka"),
    ];
    expect(labelForStops(stops, 59.33, 18.07)).toBe("Solna · Sundbyberg ...");
  });

  it("all-NULL cities → falls back to centroid label", () => {
    const stops: LabelStop[] = Array(10).fill(0).map(() => s(null));
    expect(labelForStops(stops, 59.858, 17.638)).toBe("Uppsala");
  });

  it("majority-NULL cities → falls back to centroid label even if some are tagged", () => {
    const stops: LabelStop[] = [s("Solna"), s(null), s(null), s(null), s(null), s(null)];
    expect(labelForStops(stops, 59.858, 17.638)).toBe("Uppsala");
  });

  it("treats whitespace-only and case-different city names consistently", () => {
    const stops: LabelStop[] = [
      s(" SOLNA "),
      s("Solna"),
      s("solna"),
      s(" solna "),
      s("Sundbyberg"),
    ];
    // 4/5 share for Solna (>= 70%) → bare "Solna"
    const label = labelForStops(stops, 59.33, 18.07);
    expect(label.toLowerCase()).toContain("solna");
    expect(label).not.toContain("Sundbyberg");
  });
});

describe("decorateLabelWithMode", () => {
  it("appends (lapsed) for single-mode lapsed routes", () => {
    expect(decorateLabelWithMode("Solna", "lapsed")).toBe("Solna (lapsed)");
  });
  it("appends (cold) for single-mode cold routes", () => {
    expect(decorateLabelWithMode("Uppsala", "cold")).toBe("Uppsala (cold)");
  });
  it("does NOT decorate mixed-mode routes", () => {
    expect(decorateLabelWithMode("Solna · Sundbyberg", "mixed")).toBe("Solna · Sundbyberg");
  });
});
