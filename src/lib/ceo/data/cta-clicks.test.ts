import { describe, expect, it } from "vitest";
import { locationFromPagePath } from "./cta-clicks";

const APP = "app.wrenchlane.com";
const MARKETING = "wrenchlane.com";

describe("locationFromPagePath — app (app.wrenchlane.com)", () => {
  it("maps locale-prefixed paths to their section", () => {
    expect(locationFromPagePath("/en/dashboard", APP)).toBe("dashboard");
    expect(locationFromPagePath("/sv/dashboard", APP)).toBe("dashboard");
    expect(locationFromPagePath("/ru/dashboard", APP)).toBe("dashboard");
    expect(locationFromPagePath("/de/dashboard", APP)).toBe("dashboard");
  });

  it("handles every documented app section", () => {
    expect(locationFromPagePath("/en", APP)).toBe("home");
    expect(locationFromPagePath("/en/signup", APP)).toBe("signup");
    expect(locationFromPagePath("/en/profile", APP)).toBe("profile");
    expect(locationFromPagePath("/en/pricing", APP)).toBe("pricing");
    expect(locationFromPagePath("/en/support", APP)).toBe("support");
    expect(locationFromPagePath("/en/chat", APP)).toBe("chat");
  });

  it("classifies diagnostics by prefix", () => {
    expect(locationFromPagePath("/en/diagnostics-v2/abc-123", APP)).toBe(
      "diagnostics",
    );
    expect(locationFromPagePath("/sv/diagnostics-v2/9e2d0975", APP)).toBe(
      "diagnostics",
    );
  });

  it("splits vehicle vs vehicle_service", () => {
    expect(locationFromPagePath("/sv/vehicle/301001200", APP)).toBe("vehicle");
    expect(locationFromPagePath("/sv/vehicle/301001200/service", APP)).toBe(
      "vehicle_service",
    );
  });

  it("returns 'other' for unmapped app paths", () => {
    expect(locationFromPagePath("/en/something-new", APP)).toBe("other");
    expect(locationFromPagePath("/sv/wear-parts/123", APP)).toBe("other");
  });

  it("handles edge cases without crashing", () => {
    // Empty / null / undefined collapse to home, matching the GTM JS
    // variable's `var p = {{Page Path}} || ""` fallback.
    expect(locationFromPagePath("", APP)).toBe("home");
    expect(locationFromPagePath(null, APP)).toBe("home");
    expect(locationFromPagePath(undefined, APP)).toBe("home");
    expect(locationFromPagePath("/en/", APP)).toBe("home");
  });
});

describe("locationFromPagePath — marketing (wrenchlane.com)", () => {
  it("maps marketing sections to marketing_* keys", () => {
    expect(locationFromPagePath("/en", MARKETING)).toBe("marketing_home");
    expect(locationFromPagePath("/en/pricing", MARKETING)).toBe(
      "marketing_pricing",
    );
    expect(locationFromPagePath("/en/wrenchlane-one", MARKETING)).toBe(
      "marketing_wrenchlane_one",
    );
    expect(
      locationFromPagePath("/en/faster-car-diagnostics", MARKETING),
    ).toBe("marketing_landing");
    expect(locationFromPagePath("/en/about-us", MARKETING)).toBe(
      "marketing_about",
    );
    expect(locationFromPagePath("/en/book-demo", MARKETING)).toBe(
      "marketing_book_demo",
    );
    expect(locationFromPagePath("/en/contact", MARKETING)).toBe(
      "marketing_contact",
    );
    expect(locationFromPagePath("/en/faq", MARKETING)).toBe("marketing_faq");
    expect(locationFromPagePath("/en/signup", MARKETING)).toBe(
      "marketing_signup",
    );
  });

  it("buckets article and tag prefixes", () => {
    expect(locationFromPagePath("/en/article", MARKETING)).toBe(
      "marketing_article",
    );
    expect(
      locationFromPagePath("/en/article/wrenchlane-3-0", MARKETING),
    ).toBe("marketing_article");
    expect(
      locationFromPagePath("/en/tags/live-streaming", MARKETING),
    ).toBe("marketing_tag");
  });

  it("returns marketing_other for unmapped marketing paths", () => {
    expect(locationFromPagePath("/en/some-new-page", MARKETING)).toBe(
      "marketing_other",
    );
  });

  it("does not confuse /pricing on app vs marketing", () => {
    expect(locationFromPagePath("/en/pricing", APP)).toBe("pricing");
    expect(locationFromPagePath("/en/pricing", MARKETING)).toBe(
      "marketing_pricing",
    );
  });
});

describe("locationFromPagePath — fallback when hostname omitted", () => {
  it("treats omitted host as app (the default consumer)", () => {
    expect(locationFromPagePath("/en/dashboard")).toBe("dashboard");
    expect(locationFromPagePath("/en/pricing")).toBe("pricing");
  });
});
