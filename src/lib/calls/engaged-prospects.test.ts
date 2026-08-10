import { describe, expect, it } from "vitest";
import { scoreProspect, type EngagedProspect } from "./engaged-prospects";

// Fixed "now" so day-deltas are deterministic.
const NOW = Date.parse("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const base: EngagedProspect = {
  contact_id: "c1",
  first_name: null,
  last_name: null,
  email: "info@verkstad.se",
  phone: "+46 40 123 45 67",
  company_id: null,
  company_name: "Verkstad AB",
  lead_status: "new",
  country_code: "SE",
  primary_owner_id: null,
  last_contacted_at: null,
  opens: 3,
  clicks: 0,
  emails_opened: 1,
  first_engaged_at: daysAgo(40),
  last_engaged_at: daysAgo(20),
  last_clicked_at: null,
};

describe("scoreProspect", () => {
  it("ranks a recent multi-click prospect as high priority", () => {
    const r = scoreProspect(
      { ...base, clicks: 3, last_clicked_at: daysAgo(1), last_engaged_at: daysAgo(1) },
      NOW,
    );
    expect(r.priority).toBe("high");
    expect(r.reasons[0].label).toMatch(/clicked 3 links/i);
    expect(r.reasons[0].tone).toBe("good");
  });

  it("scores a click above opens alone", () => {
    const opener = scoreProspect({ ...base, opens: 12, emails_opened: 2 }, NOW);
    const clicker = scoreProspect({ ...base, clicks: 1, last_clicked_at: daysAgo(20) }, NOW);
    expect(clicker.score).toBeGreaterThan(opener.score);
  });

  it("rewards breadth of opens over repeat opens of one email", () => {
    const oneEmail = scoreProspect({ ...base, opens: 8, emails_opened: 1 }, NOW);
    const manyEmails = scoreProspect({ ...base, opens: 8, emails_opened: 4 }, NOW);
    expect(manyEmails.score).toBeGreaterThan(oneEmail.score);
  });

  it("penalises a missing phone number, since it cannot be called", () => {
    const withPhone = scoreProspect({ ...base, clicks: 1 }, NOW);
    const without = scoreProspect({ ...base, clicks: 1, phone: null }, NOW);
    expect(without.score).toBeLessThan(withPhone.score);
    expect(without.reasons.some((r) => /no phone/i.test(r.label))).toBe(true);
  });

  it("penalises a contact called recently", () => {
    const fresh = scoreProspect({ ...base, clicks: 2 }, NOW);
    const justCalled = scoreProspect({ ...base, clicks: 2, last_contacted_at: daysAgo(3) }, NOW);
    expect(justCalled.score).toBeLessThan(fresh.score);
  });

  it("decays a prospect who has gone quiet", () => {
    const recent = scoreProspect({ ...base, clicks: 1, last_engaged_at: daysAgo(5) }, NOW);
    const stale = scoreProspect({ ...base, clicks: 1, last_engaged_at: daysAgo(45) }, NOW);
    expect(stale.score).toBeLessThan(recent.score);
  });

  it("sorts reasons by weight, strongest first", () => {
    const r = scoreProspect(
      { ...base, clicks: 3, emails_opened: 4, opens: 12, last_clicked_at: daysAgo(1) },
      NOW,
    );
    const weights = r.reasons.map((x) => x.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});
