import { describe, expect, it } from "vitest";
import { locationFromPagePath } from "./cta-clicks";

describe("locationFromPagePath", () => {
  it("maps locale-prefixed paths to their section", () => {
    expect(locationFromPagePath("/en/dashboard")).toBe("dashboard");
    expect(locationFromPagePath("/sv/dashboard")).toBe("dashboard");
    expect(locationFromPagePath("/ru/dashboard")).toBe("dashboard");
    expect(locationFromPagePath("/de/dashboard")).toBe("dashboard");
  });

  it("handles every documented section", () => {
    expect(locationFromPagePath("/en")).toBe("home");
    expect(locationFromPagePath("/en/signup")).toBe("signup");
    expect(locationFromPagePath("/en/profile")).toBe("profile");
    expect(locationFromPagePath("/en/pricing")).toBe("pricing");
    expect(locationFromPagePath("/en/support")).toBe("support");
    expect(locationFromPagePath("/en/chat")).toBe("chat");
  });

  it("classifies diagnostics by prefix", () => {
    expect(locationFromPagePath("/en/diagnostics-v2/abc-123")).toBe(
      "diagnostics",
    );
    expect(locationFromPagePath("/sv/diagnostics-v2/9e2d0975")).toBe(
      "diagnostics",
    );
  });

  it("splits vehicle vs vehicle_service", () => {
    expect(locationFromPagePath("/sv/vehicle/301001200")).toBe("vehicle");
    expect(locationFromPagePath("/sv/vehicle/301001200/service")).toBe(
      "vehicle_service",
    );
  });

  it("returns 'other' for unmapped paths", () => {
    expect(locationFromPagePath("/en/something-new")).toBe("other");
    expect(locationFromPagePath("/sv/wear-parts/123")).toBe("other");
  });

  it("handles edge cases without crashing", () => {
    // Empty / null / undefined collapse to home, matching the GTM JS
    // variable's `var p = {{Page Path}} || ""` fallback.
    expect(locationFromPagePath("")).toBe("home");
    expect(locationFromPagePath(null)).toBe("home");
    expect(locationFromPagePath(undefined)).toBe("home");
    expect(locationFromPagePath("/en/")).toBe("home");
  });
});
