import { describe, expect, it } from "vitest";
import {
  ApiFailureError,
  NOT_PROVISIONED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  describeApiFailure,
  failureFromResponse,
  isSessionExpired,
  signInHref,
  throwIfFailed,
  throwIfFailedParsed,
  toApiFailure,
} from "./api-error";
import { consumeIntentionalSignOut, markIntentionalSignOut } from "./sign-out";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("describeApiFailure", () => {
  it("turns the bare 401 that broke forums into copy with a way out", () => {
    const failure = describeApiFailure(401, "Unauthorized");
    expect(failure.kind).toBe("session-expired");
    expect(failure.message).toBe(SESSION_EXPIRED_MESSAGE);
    // The word users saw before must not be what they see now.
    expect(failure.message).not.toBe("Unauthorized");
    // Still kept for debugging.
    expect(failure.serverError).toBe("Unauthorized");
  });

  it("classifies 401 regardless of what the server called it", () => {
    expect(describeApiFailure(401, null).kind).toBe("session-expired");
    expect(describeApiFailure(401, "jwt expired").kind).toBe("session-expired");
  });

  it("explains the un-provisioned case, which needs a person not a re-login", () => {
    const failure = describeApiFailure(403, "No workspace");
    expect(failure.kind).toBe("not-provisioned");
    expect(failure.message).toBe(NOT_PROVISIONED_MESSAGE);
  });

  it("keeps a specific server message for other failures", () => {
    const failure = describeApiFailure(502, "Couldn't start the Reddit search.");
    expect(failure.kind).toBe("other");
    expect(failure.message).toBe("Couldn't start the Reddit search.");
  });

  it("does not mistake an unrelated 403 for a provisioning problem", () => {
    expect(describeApiFailure(403, "Forbidden").kind).toBe("other");
  });

  it("falls back when the server said nothing useful", () => {
    expect(describeApiFailure(500, null, "Couldn't load the board.").message).toBe(
      "Couldn't load the board.",
    );
    expect(describeApiFailure(500, "   ", "Couldn't load the board.").message).toBe(
      "Couldn't load the board.",
    );
  });
});

describe("failureFromResponse", () => {
  it("reads the error out of a JSON body", async () => {
    const failure = await failureFromResponse(jsonResponse(401, { error: "Unauthorized" }));
    expect(failure.kind).toBe("session-expired");
  });

  it("survives a body that isn't JSON at all", async () => {
    // A gateway timeout returns HTML; res.json() throwing used to mask the status.
    const res = new Response("<html>504 Gateway Timeout</html>", { status: 504 });
    const failure = await failureFromResponse(res, "Timed out.");
    expect(failure.kind).toBe("other");
    expect(failure.message).toBe("Timed out.");
  });

  it("still classifies a 401 with an empty body", async () => {
    const failure = await failureFromResponse(new Response(null, { status: 401 }));
    expect(failure.kind).toBe("session-expired");
  });
});

describe("throwIfFailed / toApiFailure", () => {
  it("carries the status through a throw instead of flattening to a string", async () => {
    let caught: unknown;
    try {
      await throwIfFailed(jsonResponse(401, { error: "Unauthorized" }), "Failed to load");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiFailureError);
    expect(toApiFailure(caught, "Failed to load").kind).toBe("session-expired");
  });

  it("does nothing for an OK response", async () => {
    await expect(throwIfFailed(jsonResponse(200, { ok: true }))).resolves.toBeUndefined();
    expect(() => throwIfFailedParsed(jsonResponse(200, {}), {})).not.toThrow();
  });

  it("classifies from an already-parsed body", () => {
    try {
      throwIfFailedParsed(jsonResponse(403, {}), { error: "No workspace" }, "Failed to load");
      throw new Error("should have thrown");
    } catch (e) {
      expect(toApiFailure(e, "Failed to load").kind).toBe("not-provisioned");
    }
  });

  it("treats a network error as a generic failure, not an auth one", () => {
    const failure = toApiFailure(new TypeError("Failed to fetch"), "Couldn't reach the server.");
    expect(failure.kind).toBe("other");
    expect(isSessionExpired(failure)).toBe(false);
  });
});

describe("signInHref", () => {
  it("sends the user back where they were", () => {
    expect(signInHref("/forums/answers")).toBe("/login?next=%2Fforums%2Fanswers");
  });

  it("refuses a destination that would leave the origin", () => {
    expect(signInHref("//evil.com")).toBe("/login");
    expect(signInHref("https://evil.com")).toBe("/login");
  });
});

describe("intentional sign-out flag", () => {
  it("reports a deliberate sign-out exactly once", () => {
    markIntentionalSignOut();
    expect(consumeIntentionalSignOut()).toBe(true);
    // A later session death must not be mistaken for the earlier click.
    expect(consumeIntentionalSignOut()).toBe(false);
  });

  it("defaults to unintentional, so a dead session is announced", () => {
    expect(consumeIntentionalSignOut()).toBe(false);
  });
});
