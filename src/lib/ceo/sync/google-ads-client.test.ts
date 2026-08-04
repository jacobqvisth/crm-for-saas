import { describe, expect, it } from "vitest";
import {
  GoogleAdsApiError,
  microsToUnits,
  normalizeCustomerId,
} from "./google-ads-client";

describe("normalizeCustomerId", () => {
  it("strips the dashes the Google Ads UI shows", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
  });

  it("leaves a bare id alone", () => {
    expect(normalizeCustomerId("1234567890")).toBe("1234567890");
  });

  it("returns empty for a value with no digits", () => {
    expect(normalizeCustomerId("not-an-id")).toBe("");
  });
});

describe("microsToUnits", () => {
  it("converts micros to currency units", () => {
    expect(microsToUnits("1500000")).toBe(1.5);
    expect(microsToUnits(2_000_000)).toBe(2);
  });

  it("treats missing values as zero rather than NaN", () => {
    expect(microsToUnits(null)).toBe(0);
    expect(microsToUnits(undefined)).toBe(0);
    expect(microsToUnits("not a number")).toBe(0);
  });
});

describe("GoogleAdsApiError.isAccessLevelProblem", () => {
  it("flags a 403 as an access-level problem", () => {
    const error = new GoogleAdsApiError("denied", 403, []);
    expect(error.isAccessLevelProblem).toBe(true);
  });

  it("flags the developer-token refusal an Explorer token gets on Keyword Planner", () => {
    const error = new GoogleAdsApiError("refused", 400, [
      "authorizationErrorEnum.DEVELOPER_TOKEN_NOT_APPROVED",
    ]);
    expect(error.isAccessLevelProblem).toBe(true);
  });

  it("flags PERMISSION_DENIED", () => {
    const error = new GoogleAdsApiError("nope", 400, ["PERMISSION_DENIED"]);
    expect(error.isAccessLevelProblem).toBe(true);
  });

  it("does not flag an ordinary bad request, so it is not silently swallowed", () => {
    const error = new GoogleAdsApiError("bad query", 400, [
      "queryErrorEnum.BAD_FIELD_NAME",
    ]);
    expect(error.isAccessLevelProblem).toBe(false);
  });

  it("does not flag a server error", () => {
    const error = new GoogleAdsApiError("boom", 500, ["INTERNAL"]);
    expect(error.isAccessLevelProblem).toBe(false);
  });
});
