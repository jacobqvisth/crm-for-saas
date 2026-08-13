import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPhones, type PhoneSearchProgress } from "./find-phone";

// The Google-Maps leg and the Anthropic client are the two external calls we must
// not make in a unit test. Both are stubbed so we can assert purely on which legs
// the time budget lets run.
const gmapsMock = vi.fn();
vi.mock("./find-phone-gmaps", () => ({
  findPhonesViaGoogleMaps: (...args: unknown[]) => gmapsMock(...args),
}));

const createMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  },
}));

/** A page whose footer carries a tel: link, like a real workshop site. */
const PAGE_WITH_PHONE = '<html><body><a href="tel:+46 8 123 45 67">Ring oss</a></body></html>';
const PAGE_WITHOUT_PHONE = "<html><body><p>Välkommen</p></body></html>";

function mockFetchReturning(html: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => html,
  });
}

const baseInput = {
  name: "Testverkstad AB",
  companyName: "Testverkstad AB",
  city: "Stockholm",
  country: "Sweden",
  countryCode: "SE",
  websites: ["https://testverkstad.se"],
};

describe("findPhones time budget", () => {
  beforeEach(() => {
    gmapsMock.mockReset();
    createMock.mockReset();
    gmapsMock.mockResolvedValue(null);
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips every external leg when the deadline has already passed", async () => {
    const fetchMock = mockFetchReturning(PAGE_WITH_PHONE);
    vi.stubGlobal("fetch", fetchMock);

    const result = await findPhones({ ...baseInput, deadline: Date.now() - 1_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(gmapsMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(result.found).toBe(false);
    expect(result.debug?.skippedForTime).toContain("scrape");
  });

  it("returns a scraped number without touching Google Maps or the web search", async () => {
    const fetchMock = mockFetchReturning(PAGE_WITH_PHONE);
    vi.stubGlobal("fetch", fetchMock);

    const result = await findPhones({ ...baseInput, deadline: Date.now() + 150_000 });

    expect(result.found).toBe(true);
    expect(result.phones[0].number).toBe("+4681234567");
    expect(result.phones[0].source).toBe("website");
    // The whole point of the leg ordering: a cheap hit short-circuits the slow legs.
    expect(gmapsMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("falls through to Google Maps with a budget derived from the time left", async () => {
    // A full budget, so the scrape really runs; the page has no number, so the
    // Maps leg is reached the way it is in production.
    const fetchMock = mockFetchReturning(PAGE_WITHOUT_PHONE);
    vi.stubGlobal("fetch", fetchMock);

    await findPhones({ ...baseInput, deadline: Date.now() + 150_000 });

    expect(fetchMock).toHaveBeenCalled();
    expect(gmapsMock).toHaveBeenCalledTimes(1);
    const budget = (gmapsMock.mock.calls[0][0] as { budgetMs: number }).budgetMs;
    expect(budget).toBeGreaterThan(0);
    // Bounded by the leg's own ceiling AND by what the deadline actually leaves.
    expect(budget).toBeLessThanOrEqual(55_000);
  });

  it("shrinks the Google Maps budget when the deadline is close", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(PAGE_WITHOUT_PHONE));

    await findPhones({ ...baseInput, deadline: Date.now() + 60_000 });

    const budget = (gmapsMock.mock.calls[0][0] as { budgetMs: number }).budgetMs;
    // 60s left minus the reserve held back for the web search, so well under the
    // 55s ceiling. The old fixed 55s here is what overran the function.
    expect(budget).toBeLessThan(20_000);
    expect(budget).toBeGreaterThan(0);
  });

  it("starts nothing it cannot finish, and says why", async () => {
    const fetchMock = mockFetchReturning(PAGE_WITHOUT_PHONE);
    vi.stubGlobal("fetch", fetchMock);

    // Only 20s left: too little for any leg, so we return a clear reason instead
    // of starting work the platform timeout would discard.
    const result = await findPhones({ ...baseInput, deadline: Date.now() + 20_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(gmapsMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(result.debug?.skippedForTime).toContain("web-search");
    expect(result.reasoning).toMatch(/ran out of time/i);
  });

  it("reports every leg through onProgress, in order", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(PAGE_WITH_PHONE));
    const events: PhoneSearchProgress[] = [];

    await findPhones({
      ...baseInput,
      deadline: Date.now() + 150_000,
      onProgress: (e) => events.push(e),
    });

    const stages = events.map((e) => e.stage);
    expect(stages).toContain("scrape");
    expect(stages.indexOf("scrape")).toBeLessThan(stages.indexOf("google-maps"));
    expect(stages.indexOf("google-maps")).toBeLessThan(stages.indexOf("web-search"));
    // Legs short-circuited by an earlier hit are reported as skipped, not silent.
    expect(events.find((e) => e.stage === "google-maps")?.status).toBe("skip");
    expect(events.find((e) => e.stage === "web-search")?.status).toBe("skip");
    expect(events.find((e) => e.stage === "scrape")?.status).toBe("start");
  });

  it("survives an onProgress callback that throws", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(PAGE_WITH_PHONE));

    const result = await findPhones({
      ...baseInput,
      deadline: Date.now() + 150_000,
      onProgress: () => {
        throw new Error("client hung up");
      },
    });

    expect(result.found).toBe(true);
  });
});
