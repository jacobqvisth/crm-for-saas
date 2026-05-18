import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { DomainHealthCheck } from "./index";
import { notifyDomainHealth } from "./notify";

function check(overrides: Partial<DomainHealthCheck> = {}): DomainHealthCheck {
  return {
    domain: "wrenchlane.com",
    checked_at: "2026-05-18T08:30:00.000Z",
    dns_records: {
      spf: { ok: true, value: "v=spf1" },
      dkim: { ok: true, value: "v=DKIM1", selector: "google" },
      dmarc: { ok: true, value: "v=DMARC1; p=reject", policy: "reject" },
      mx: { ok: true, value: "1 smtp.google.com" },
    },
    blocklists: [],
    send_metrics: {
      window_hours: 24,
      sent: 100,
      bounces: 1,
      unsubscribes: 1,
      replies: 2,
      bounce_rate: 0.01,
      unsubscribe_rate: 0.01,
      queue_failures: 0,
      rolling_7d_avg_daily_volume: 100,
      volume_vs_7d_avg: 1,
    },
    status: "ok",
    alerts: [],
    run_notes: null,
    ...overrides,
  };
}

describe("notifyDomainHealth", () => {
  const originalWebhook = process.env.SLACK_ALERT_WEBHOOK_URL;

  beforeEach(() => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalWebhook !== undefined) {
      process.env.SLACK_ALERT_WEBHOOK_URL = originalWebhook;
    }
    vi.restoreAllMocks();
  });

  it("does not notify when status is ok", async () => {
    const out = await notifyDomainHealth(check({ status: "ok" }), null);
    expect(out.sent).toBe(false);
    expect(out.channel).toBe("none");
  });

  it("always notifies on critical", async () => {
    const out = await notifyDomainHealth(
      check({ status: "critical", alerts: ["Bounce rate 7%"] }),
      null,
    );
    expect(out.sent).toBe(true);
    expect(out.channel).toBe("console"); // no webhook set, falls back
  });

  it("notifies on first-run warning", async () => {
    const out = await notifyDomainHealth(
      check({ status: "warning", alerts: ["Bounce rate 4%"] }),
      null,
    );
    expect(out.sent).toBe(true);
  });

  it("notifies on regression ok → warning", async () => {
    const out = await notifyDomainHealth(
      check({ status: "warning", alerts: ["Bounce rate 4%"] }),
      check({ status: "ok" }),
    );
    expect(out.sent).toBe(true);
    expect(out.reason).toMatch(/regression/);
  });

  it("does NOT re-notify when warning persists with identical alerts", async () => {
    const prev = check({ status: "warning", alerts: ["Bounce rate 4%"] });
    const curr = check({ status: "warning", alerts: ["Bounce rate 4%"] });
    const out = await notifyDomainHealth(curr, prev);
    expect(out.sent).toBe(false);
    expect(out.reason).toMatch(/same warning/);
  });

  it("does re-notify when warning persists but alert set changed", async () => {
    const prev = check({ status: "warning", alerts: ["Bounce rate 4%"] });
    const curr = check({
      status: "warning",
      alerts: ["Bounce rate 4%", "Unsubscribe rate 2.5%"],
    });
    const out = await notifyDomainHealth(curr, prev);
    expect(out.sent).toBe(true);
    expect(out.reason).toMatch(/alert set changed/);
  });
});
