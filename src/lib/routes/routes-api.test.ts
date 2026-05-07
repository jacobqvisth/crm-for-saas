import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeFixedOrder } from "./routes-api";

describe("recomputeFixedOrder", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "stub";
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    vi.restoreAllMocks();
  });

  it("calls Routes API with optimizeWaypointOrder=false and returns parsed legs + polyline", async () => {
    const fakeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              duration: "5400s",
              distanceMeters: 12345,
              polyline: { encodedPolyline: "abc_def~123" },
              legs: [
                { duration: "1800s", distanceMeters: 4000 },
                { duration: "1800s", distanceMeters: 4000 },
                { duration: "1800s", distanceMeters: 4345 },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await recomputeFixedOrder({
      origin: { lat: 59.36, lng: 17.87 },
      orderedWaypoints: [
        { lat: 59.33, lng: 18.07 },
        { lat: 59.4, lng: 17.95 },
      ],
      returnToOrigin: true,
    });

    expect(result.totalSeconds).toBe(5400);
    expect(result.totalMeters).toBe(12345);
    expect(result.encodedPolyline).toBe("abc_def~123");
    expect(result.legs).toHaveLength(3);
    expect(result.orderedWaypointIndices).toEqual([0, 1]); // identity, no reordering

    // Confirm we asked Google NOT to reorder.
    const [, init] = fakeFetch.mock.calls[0]!;
    const body = JSON.parse((init?.body as string) ?? "{}");
    expect(body.optimizeWaypointOrder).toBe(false);
  });

  it("throws on Routes API error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      recomputeFixedOrder({
        origin: { lat: 0, lng: 0 },
        orderedWaypoints: [{ lat: 1, lng: 1 }],
      }),
    ).rejects.toThrow(/HTTP 429/);
  });
});
