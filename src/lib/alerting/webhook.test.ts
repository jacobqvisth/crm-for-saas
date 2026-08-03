import { afterEach, describe, expect, it, vi } from "vitest";
import { postAlert, resolveAlertWebhook } from "./webhook";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveAlertWebhook", () => {
  it("prefers the dedicated alert variable", () => {
    const resolved = resolveAlertWebhook({
      SLACK_ALERT_WEBHOOK_URL: "https://hooks.slack.test/alert",
      SLACK_BUG_REPORTS_WEBHOOK_URL: "https://hooks.slack.test/bugs",
    });

    expect(resolved).toEqual({
      url: "https://hooks.slack.test/alert",
      source: "SLACK_ALERT_WEBHOOK_URL",
      isFallback: false,
    });
  });

  // This is the production configuration that made 22 days of core_app sync
  // failures invisible: the detector worked, but SLACK_ALERT_WEBHOOK_URL was
  // never set, so every alert went to stdout.
  it("falls back to the bug-reports webhook when the alert variable is unset", () => {
    const resolved = resolveAlertWebhook({
      SLACK_BUG_REPORTS_WEBHOOK_URL: "https://hooks.slack.test/bugs",
    });

    expect(resolved).toMatchObject({
      url: "https://hooks.slack.test/bugs",
      source: "SLACK_BUG_REPORTS_WEBHOOK_URL",
      isFallback: true,
    });
  });

  it("treats a blank value as unset rather than posting to an empty URL", () => {
    const resolved = resolveAlertWebhook({
      SLACK_ALERT_WEBHOOK_URL: "   ",
      SLACK_BUG_REPORTS_WEBHOOK_URL: "https://hooks.slack.test/bugs",
    });

    expect(resolved?.source).toBe("SLACK_BUG_REPORTS_WEBHOOK_URL");
  });

  it("never routes alerts to the forum-posts channel", () => {
    const resolved = resolveAlertWebhook({
      SLACK_FORUM_POSTS_WEBHOOK_URL: "https://hooks.slack.test/forums",
    });

    expect(resolved).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    expect(resolveAlertWebhook({})).toBeNull();
  });
});

describe("postAlert", () => {
  it("posts the text to the resolved webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await postAlert("sync-health", "core_app is down", {
      SLACK_ALERT_WEBHOOK_URL: "https://hooks.slack.test/alert",
    });

    expect(outcome).toEqual({
      channel: "slack",
      sent: true,
      webhookSource: "SLACK_ALERT_WEBHOOK_URL",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/alert");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "core_app is down",
    });
  });

  it("reports console when no webhook is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await postAlert("sync-health", "core_app is down", {});

    expect(outcome).toMatchObject({ channel: "console", webhookSource: null });
    expect(fetchMock).not.toHaveBeenCalled();
    // The operator needs to know delivery silently degraded.
    expect(
      errorSpy.mock.calls.some(([line]) =>
        String(line).includes("no alert webhook configured"),
      ),
    ).toBe(true);
  });

  it("degrades to console when Slack rejects the post", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await postAlert("sync-health", "core_app is down", {
      SLACK_ALERT_WEBHOOK_URL: "https://hooks.slack.test/alert",
    });

    expect(outcome.channel).toBe("console");
  });

  it("degrades to console when the fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await postAlert("domain-health", "dmarc regressed", {
      SLACK_ALERT_WEBHOOK_URL: "https://hooks.slack.test/alert",
    });

    expect(outcome.channel).toBe("console");
  });

  it("always echoes the alert text to the logs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await postAlert("sync-health", "core_app is down", {
      SLACK_ALERT_WEBHOOK_URL: "https://hooks.slack.test/alert",
    });

    expect(
      errorSpy.mock.calls.some(([line]) =>
        String(line).includes("core_app is down"),
      ),
    ).toBe(true);
  });
});
