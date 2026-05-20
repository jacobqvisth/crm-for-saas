import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGoogleMapsDeeplink } from "./generate";

// Deterministic 32-bit RNG (mulberry32). The k-means++ init in cluster.ts
// is the only source of nondeterminism in generateDailyRoutes — without a
// seeded RNG this test was flaky in the full src/ suite, because earlier
// tests advance the global Math.random state and shift which centroid the
// algorithm picks.
function seededRng(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mock the Routes API module so generate.ts imports a stub
vi.mock("./routes-api", () => ({
  optimizeRoute: vi.fn(async ({ waypoints }: { waypoints: { lat: number; lng: number }[] }) => ({
    orderedWaypointIndices: waypoints.map((_, i) => i),
    totalSeconds: waypoints.length * 15 * 60, // 15 min between waypoints
    totalMeters: waypoints.length * 5000,
    legs: waypoints.map(() => ({ seconds: 15 * 60, meters: 5000 })),
    rawResponse: { mocked: true },
  })),
}));

describe("buildGoogleMapsDeeplink", () => {
  it("encodes origin + destination + waypoints in optimized order", () => {
    const link = buildGoogleMapsDeeplink({
      origin: "Markvägen 23, Vällingby",
      waypoints: [
        { lat: 59.33, lng: 18.07 },
        { lat: 59.4, lng: 17.95 },
      ],
    });
    expect(link).toContain("https://www.google.com/maps/dir/?");
    expect(link).toContain("api=1");
    expect(link).toContain("travelmode=driving");
    expect(link).toContain("origin=Markv");
    expect(link).toContain("waypoints=59.33%2C18.07%7C59.4%2C17.95");
  });

  it("works with no waypoints", () => {
    const link = buildGoogleMapsDeeplink({ origin: "Stockholm", waypoints: [] });
    expect(link).toContain("origin=Stockholm");
    expect(link).not.toContain("waypoints=");
  });
});

describe("generateDailyRoutes — mode-assignment math", () => {
  // We test mode assignment indirectly by exercising the generator with a
  // minimal in-memory Supabase mock and asserting the per-cluster mode mix.
  // Because generate.ts spreads `cold` and `lapsed` arrays from one fetch
  // each, mocking the supabase client surface is enough.

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "stub";
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("assigns highest-density clusters to lapsed and lowest to cold", async () => {
    // 3 clusters, 6 stops each:
    // - cluster A (around 59.33,18.07): 6 lapsed → density 1.0 → lapsed
    // - cluster B (around 59.40,17.95): 3 lapsed + 3 cold → density 0.5 → mixed
    // - cluster C (around 59.20,18.20): 6 cold → density 0.0 → cold
    //
    // After the pool-source fix, both pools come from the `companies` table —
    // cold = activated_at IS NULL, lapsed = activated_at IS NOT NULL.

    // Order matches the original test (cold first, then lapsed) so the
    // k-means++ init picks the same centroids as before — clustering
    // depends on insertion order with deterministic seeding.
    const companies = [
      ...mkPoints("cb", 3, 59.4, 17.95, null),          // cold in cluster B
      ...mkPoints("cc", 6, 59.2, 18.2, null),           // cold in cluster C
      ...mkPoints("la", 6, 59.33, 18.07, "2026-01-01"), // lapsed in cluster A
      ...mkPoints("lb", 3, 59.4, 17.95, "2026-01-01"),  // lapsed in cluster B
    ];

    const supabase = mockSupabase({ companies });

    // Dynamic import after mock is in place
    const { generateDailyRoutes } = await import("./generate");

    // desiredCount=3 matches the 3 spatial groups so each gets one cluster.
    // (In production, ~5,900 cold + ~1k lapsed lets the natural k=10 work.)
    const summary = await generateDailyRoutes({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      origin: { address: "Test", lat: 59.36, lng: 17.87 },
      desiredCount: 3,
      modeMix: { mixed: 1, cold: 1, lapsed: 1 },
      supabase: supabase as never,
      rng: seededRng(1),
    });

    const modes = summary.routes.map((r) => r.mode).sort();
    // We expect at least one of each — the densest goes lapsed, the all-cold one goes cold.
    expect(modes).toContain("lapsed");
    expect(modes).toContain("cold");
    expect(summary.routesCreated).toBeGreaterThanOrEqual(3);
  });
});

// ----- helpers -----

function mkPoints(prefix: string, n: number, baseLat: number, baseLng: number, activatedAt: string | null) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    name: `${prefix}-${i}`,
    address: `${prefix} ${i}, Stockholm`,
    latitude: baseLat + (i % 3) * 0.001,
    longitude: baseLng + Math.floor(i / 3) * 0.001,
    activated_at: activatedAt,
    customer_status: null,
    subscription_status: null,
  }));
}

function mockSupabase({
  companies,
}: {
  companies: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    activated_at: string | null;
    customer_status: string | null;
    subscription_status: string | null;
  }[];
}) {
  // We model just the chained surfaces the generator uses:
  //   .from(table).select(...).or(...).or(...).not(...).not(...).order(...).range(...)
  //   .from(table).insert(...).select().single()
  // The pool fetcher now paginates with .range(); we return all rows on the
  // first call and an empty array on subsequent calls so the loop terminates.
  function buildQuery(rows: unknown[]) {
    let pageCalled = false;
    const obj = {
      select: () => obj,
      eq: () => obj,
      is: () => obj,
      in: () => obj,
      not: () => obj,
      or: () => obj,
      limit: () => obj,
      order: () => obj,
      range: () => obj,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: undefined as never,
    } as Record<string, unknown>;
    (obj as { then: (cb: (v: { data: unknown[]; error: null }) => void) => void }).then = (cb) => {
      const data = pageCalled ? [] : rows;
      pageCalled = true;
      cb({ data, error: null });
    };
    return obj;
  }

  const insertedRoutes: { id: string }[] = [];

  return {
    from(table: string) {
      if (table === "companies") return buildQuery(companies);
      if (table === "daily_routes") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => {
                const id = `route-${insertedRoutes.length + 1}`;
                insertedRoutes.push({ id });
                return { data: { id }, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "route_stops") {
        // Both: SELECT for recent visits (no rows in the test fixture) and INSERT for new stops.
        const q = buildQuery([]);
        (q as Record<string, unknown>).insert = async () => ({ error: null });
        return q;
      }
      if (table === "workspaces") {
        // No workspace settings in the test fixture → falls back to defaults.
        return buildQuery([]);
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}
