import { describe, expect, it } from "vitest";

import { evaluate, THRESHOLDS } from "./index";
import type { BlocklistResult } from "./dnsbl";
import type { DnsSnapshot } from "./dns";
import type { SendMetrics } from "./metrics";

function dns(overrides: Partial<DnsSnapshot> = {}): DnsSnapshot {
  return {
    spf: { ok: true, value: "v=spf1 -all" },
    dkim: { ok: true, value: "v=DKIM1;p=...", selector: "google" },
    dmarc: { ok: true, value: "v=DMARC1; p=reject;", policy: "reject" },
    mx: { ok: true, value: "1 smtp.google.com" },
    ...overrides,
  };
}

function metrics(overrides: Partial<SendMetrics> = {}): SendMetrics {
  return {
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
    ...overrides,
  };
}

describe("evaluate", () => {
  it("returns ok with no alerts when everything is healthy", () => {
    const result = evaluate("wrenchlane.com", dns(), [], metrics());
    expect(result.status).toBe("ok");
    expect(result.alerts).toEqual([]);
  });

  it("flags missing SPF as critical", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns({ spf: { ok: false, value: null, note: "no record" } }),
      [],
      metrics(),
    );
    expect(result.status).toBe("critical");
    expect(result.alerts[0]).toMatch(/SPF/);
  });

  it("flags missing DKIM as critical", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns({ dkim: { ok: false, value: null, selector: "", note: "none found" } }),
      [],
      metrics(),
    );
    expect(result.status).toBe("critical");
    expect(result.alerts[0]).toMatch(/DKIM/);
  });

  it("warns on DMARC p=none even if record present", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns({ dmarc: { ok: true, value: "v=DMARC1; p=none;", policy: "none" } }),
      [],
      metrics(),
    );
    expect(result.status).toBe("warning");
    expect(result.alerts[0]).toMatch(/policy=none/);
  });

  it("treats a confirmed blocklist hit as critical", () => {
    const bl: BlocklistResult[] = [
      {
        list: "dbl.spamhaus.org",
        state: "listed",
        raw: "127.0.1.2",
        note: "spam domain",
      },
    ];
    const result = evaluate("wrenchlane.com", dns(), bl, metrics());
    expect(result.status).toBe("critical");
    expect(result.alerts.some((a) => a.includes("dbl.spamhaus.org"))).toBe(true);
  });

  it("does NOT alert on refused blocklist responses (rate-limit gotcha)", () => {
    const bl: BlocklistResult[] = [
      {
        list: "dbl.spamhaus.org",
        state: "refused",
        raw: "127.255.255.254",
        note: "resolver refusal code",
      },
      {
        list: "multi.uribl.com",
        state: "refused",
        raw: "127.0.0.1",
        note: "resolver refusal code",
      },
    ];
    const result = evaluate("wrenchlane.com", dns(), bl, metrics());
    expect(result.status).toBe("ok");
    expect(result.alerts).toEqual([]);
  });

  it("warns when bounce rate crosses 3%", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns(),
      [],
      metrics({ sent: 100, bounces: 4, bounce_rate: 0.04 }),
    );
    expect(result.status).toBe("warning");
    expect(result.alerts.some((a) => a.startsWith("Bounce rate"))).toBe(true);
  });

  it("escalates to critical when bounce rate ≥5% (Gmail throttle zone)", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns(),
      [],
      metrics({ sent: 100, bounces: 6, bounce_rate: 0.06 }),
    );
    expect(result.status).toBe("critical");
  });

  it("warns when unsubscribe rate ≥ 2%", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns(),
      [],
      metrics({ sent: 100, unsubscribes: 3, unsubscribe_rate: 0.03 }),
    );
    expect(result.status).toBe("warning");
    expect(result.alerts.some((a) => a.startsWith("Unsubscribe rate"))).toBe(true);
  });

  it("warns on volume spike but ignores spikes from near-zero baseline", () => {
    // 5x but baseline only 2 emails/day → noise, don't alert
    const noBaseline = evaluate(
      "wrenchlane.com",
      dns(),
      [],
      metrics({
        sent: 10,
        rolling_7d_avg_daily_volume: 2,
        volume_vs_7d_avg: 5,
      }),
    );
    expect(noBaseline.status).toBe("ok");

    // 5x with a real baseline → alert
    const realSpike = evaluate(
      "wrenchlane.com",
      dns(),
      [],
      metrics({
        sent: 600,
        rolling_7d_avg_daily_volume: 120,
        volume_vs_7d_avg: 5,
      }),
    );
    expect(realSpike.status).toBe("warning");
    expect(
      realSpike.alerts.some((a) => a.includes("runaway sequence")),
    ).toBe(true);
  });

  it("collapses to highest severity when several signals fire", () => {
    const result = evaluate(
      "wrenchlane.com",
      dns({ spf: { ok: false, value: null, note: "missing" } }),
      [],
      metrics({ sent: 100, bounces: 4, bounce_rate: 0.04 }),
    );
    // SPF missing is critical, bounce >3 is warning → final status critical.
    expect(result.status).toBe("critical");
    // Both alerts present.
    expect(result.alerts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("THRESHOLDS", () => {
  it("matches the documented design (3% / 5% / 2% / 3×)", () => {
    expect(THRESHOLDS.bounce_warning).toBe(0.03);
    expect(THRESHOLDS.bounce_critical).toBe(0.05);
    expect(THRESHOLDS.unsubscribe_warning).toBe(0.02);
    expect(THRESHOLDS.volume_spike_warning).toBe(3);
  });
});
