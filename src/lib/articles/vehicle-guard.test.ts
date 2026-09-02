// The regression this guards is real and published: on 2026-09-01 the Autopilot
// wrote "A 2016 Ford rolled into a German workshop" and four paragraphs about a
// "2.0 EcoBlue" engine, on a diagnostic whose make and model were both null.

import { describe, expect, it } from "vitest";
import { checkVehicleClaims } from "./vehicle-guard";

const article = (over: Partial<Parameters<typeof checkVehicleClaims>[0]> = {}) =>
  checkVehicleClaims({
    sourceKind: "diagnostic",
    snapshot: { carMake: null, carModel: null },
    title: "Diagnosing P0299",
    body: "The vehicle came in with an underboost code.",
    ...over,
  });

describe("checkVehicleClaims", () => {
  it("passes an article that does not name a vehicle it was not given", () => {
    expect(article().ok).toBe(true);
  });

  it("catches the exact article that shipped", () => {
    const r = article({
      title: "Diagnosing P0299 Alongside an AdBlue Fault",
      body: "A 2016 Ford rolled into a German workshop with a P0299 underboost code. The 2.0 EcoBlue engine is known for this.",
    });
    expect(r.ok).toBe(false);
    expect(r.offences).toContain("Ford");
    expect(r.offences).toContain("EcoBlue");
    expect(r.reason).toMatch(/invented vehicle/i);
  });

  it("catches a marque in the title alone", () => {
    expect(article({ title: "Diagnosing a Volvo V90 underboost fault" }).ok).toBe(false);
  });

  it("allows any marque when the make is known", () => {
    // A real case study may compare against other marques. Only a nameless
    // vehicle makes naming one an invention.
    const r = article({
      snapshot: { carMake: "Volvo", carModel: "V90" },
      body: "The Volvo behaved differently from the Ford we saw last week.",
    });
    expect(r.ok).toBe(true);
  });

  it("still catches an engine family when the make is known but the model is not", () => {
    const r = article({
      snapshot: { carMake: "Ford", carModel: null },
      body: "The 2.0 EcoBlue engine is known for this.",
    });
    expect(r.ok).toBe(false);
    expect(r.offences).toEqual(["EcoBlue"]);
    expect(r.reason).toMatch(/no model recorded/i);
  });

  it("leaves stats stories alone", () => {
    // A fleet-wide story names marques by design.
    const r = article({
      sourceKind: "stats",
      body: "Volkswagen and Volvo together account for most coded diagnostics.",
    });
    expect(r.ok).toBe(true);
  });

  it("does not fire on ordinary prose that contains no marque", () => {
    const r = article({
      body: "A smart approach is to ram the probe home, then check the mini fuse and the seat sensor.",
    });
    // Smart, Ram, Mini and Seat are all real marques; the first three are
    // deliberately not in the vocabulary because they are ordinary English.
    expect(r.offences).not.toContain("Smart");
    expect(r.offences).not.toContain("Ram");
    expect(r.offences).not.toContain("Mini");
  });

  it("matches whole words only", () => {
    // "Fordist", "seatbelt", "Audiophile": substrings of marques inside longer
    // words must not fire.
    const r = article({ body: "Fordism and the seatbelt pretensioner and an audiophile stereo." });
    expect(r.ok).toBe(true);
  });

  it("is case insensitive", () => {
    expect(article({ body: "a FORD van" }).ok).toBe(false);
  });

  it("handles the accented marque", () => {
    expect(article({ body: "The Citroën came in on a flatbed." }).ok).toBe(false);
  });

  it("reports Mercedes-Benz once, not twice", () => {
    const r = article({ body: "The Mercedes-Benz was towed in." });
    expect(r.offences).toEqual(["Mercedes-Benz"]);
  });

  it("treats an empty make string as absent", () => {
    const r = article({ snapshot: { carMake: "   ", carModel: null }, body: "The Ford came in." });
    expect(r.ok).toBe(false);
  });

  it("passes when there is no snapshot at all", () => {
    // Nothing to contradict, and blocking every snapshot-less draft would be a
    // worse failure than the one being prevented.
    expect(article({ snapshot: null, body: "The vehicle came in." }).ok).toBe(true);
  });
});
