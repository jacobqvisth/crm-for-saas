import { describe, expect, it } from "vitest";
import { friendlyAiError } from "./friendly-error";

// The exact string the SDK threw when the Anthropic account ran dry, which the
// call drawer used to render verbatim at the rep.
const CREDIT_ERROR =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit ' +
  'balance is too low to access the Anthropic API. Please go to Plans & Billing to ' +
  'upgrade or purchase credits."},"request_id":"req_011CeSvU35vxkZvznaBSe3DG"}';

describe("friendlyAiError", () => {
  it("explains an out-of-credits failure without leaking JSON", () => {
    const out = friendlyAiError(CREDIT_ERROR);
    expect(out).toContain("out of credits");
    expect(out).toContain("console.anthropic.com");
    expect(out).not.toContain("{");
    expect(out).not.toContain("request_id");
  });

  it("names the fix for key problems", () => {
    expect(friendlyAiError("ANTHROPIC_API_KEY not set")).toContain("missing");
    expect(
      friendlyAiError('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
    ).toContain("rejected");
  });

  it("tells the rep to retry on transient provider failures", () => {
    expect(
      friendlyAiError('429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}'),
    ).toContain("rate-limiting");
    expect(
      friendlyAiError('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'),
    ).toContain("overloaded");
    expect(friendlyAiError("Request timed out.")).toContain("timed out");
  });

  it("unwraps unrecognised provider errors to just their message", () => {
    expect(
      friendlyAiError('400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens too large"}}'),
    ).toBe("max_tokens too large");
  });

  it("passes plain strings through and handles nothing at all", () => {
    expect(friendlyAiError("model did not return tool output")).toBe(
      "model did not return tool output",
    );
    expect(friendlyAiError(null)).toContain("unknown reason");
  });
});
