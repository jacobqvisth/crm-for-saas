import { describe, expect, it, vi } from "vitest";
import { getTenant } from "@/config/tenants";
import { FEATURE_KEYS } from "@/config/features";
import {
  compiledConfig,
  normalizeFlags,
  pullConfig,
  resolveConfig,
  type ConfigCache,
} from "./resolve";

// The five verifications the phase 05 brief asks for, as tests rather than a
// checklist. This is the phase where a mistake silently changes behaviour for a
// real business, so each one is pinned.

const compiled = () => getTenant().features;

function fakeCache(initial: { features: unknown; settings: unknown; fetchedAt: string } | null) {
  const store = { current: initial };
  const cache: ConfigCache & { writes: number } = {
    writes: 0,
    async read() {
      return store.current;
    },
    async write(v) {
      cache.writes++;
      store.current = { features: v.features, settings: v.settings, fetchedAt: "written" };
    },
  };
  return cache;
}

const okPull = (features: Record<string, boolean>) =>
  vi.fn(async () => ({ ok: true as const, features: normalizeFlags(features), settings: {} }));

const failPull = (error = "HTTP 500") => vi.fn(async () => ({ ok: false as const, error }));

describe("1. reachable control plane, no overrides", () => {
  // The most important test in the phase: with nothing overridden, the value
  // the app runs on must be IDENTICAL to what it compiled with. Anything else
  // means phase 05 changed Wrenchlane's behaviour, which R1 forbids.
  it("resolves to exactly the compiled defaults", async () => {
    const cfg = await resolveConfig({ pull: okPull(compiled()), cacheImpl: fakeCache(null) });
    expect(cfg.source).toBe("live");
    expect(cfg.features).toEqual(compiled());
    for (const key of FEATURE_KEYS) {
      expect(cfg.features[key], key).toBe(compiled()[key]);
    }
  });

  it("writes what it pulled into the cache", async () => {
    const cache = fakeCache(null);
    await resolveConfig({ pull: okPull(compiled()), cacheImpl: cache });
    expect(cache.writes).toBe(1);
  });
});

describe("2. control plane returning 500, cache present", () => {
  it("serves from cache and says so", async () => {
    const cached = { ...compiled(), forums: false };
    const cfg = await resolveConfig({
      pull: failPull(),
      cacheImpl: fakeCache({ features: cached, settings: {}, fetchedAt: "2026-08-30T00:00:00Z" }),
    });
    expect(cfg.source).toBe("cache");
    expect(cfg.features.forums).toBe(false);
    // and everything else still resolves
    expect(cfg.features.dtc).toBe(true);
  });

  it("logs a warning rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await resolveConfig({
      pull: failPull(),
      cacheImpl: fakeCache({ features: compiled(), settings: {}, fetchedAt: "x" }),
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("3. control plane 500 AND cache empty", () => {
  it("serves compiled defaults and still boots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = await resolveConfig({ pull: failPull(), cacheImpl: fakeCache(null) });
    expect(cfg.source).toBe("compiled");
    expect(cfg.features).toEqual(compiled());
    warn.mockRestore();
  });

  it("survives no cache layer at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = await resolveConfig({ pull: failPull(), cacheImpl: null });
    expect(cfg.source).toBe("compiled");
    warn.mockRestore();
  });

  it("survives a cache that throws on read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: ConfigCache = {
      async read() {
        throw new Error("database is on fire");
      },
      async write() {},
    };
    const cfg = await resolveConfig({ pull: failPull(), cacheImpl: broken });
    expect(cfg.source).toBe("compiled");
    warn.mockRestore();
  });

  it("survives a cache that throws on write after a good pull", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: ConfigCache = {
      async read() {
        return null;
      },
      async write() {
        throw new Error("read-only replica");
      },
    };
    const cfg = await resolveConfig({ pull: okPull(compiled()), cacheImpl: broken });
    // The pull succeeded, so the live values are still what we serve.
    expect(cfg.source).toBe("live");
    warn.mockRestore();
  });
});

describe("4. a wrong token", () => {
  it("falls back rather than crashing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = await resolveConfig({ pull: failPull("HTTP 401"), cacheImpl: fakeCache(null) });
    expect(cfg.source).toBe("compiled");
    warn.mockRestore();
  });

  it("pullConfig reports a 401 as not-ok instead of throwing", async () => {
    const res = await pullConfig({
      url: "https://control.example",
      token: "wrong",
      fetchImpl: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("HTTP 401");
  });
});

describe("5. a toggle changes behaviour", () => {
  it("an override in the pulled response wins over the compiled default", async () => {
    const cfg = await resolveConfig({
      pull: okPull({ ...compiled(), reviews: false }),
      cacheImpl: fakeCache(null),
    });
    expect(compiled().reviews).toBe(true);
    expect(cfg.features.reviews).toBe(false);
  });
});

describe("pullConfig never throws", () => {
  it("returns not-ok when unconfigured", async () => {
    expect((await pullConfig({ url: undefined, token: undefined })).ok).toBe(false);
  });

  it("returns not-ok when the network rejects", async () => {
    const res = await pullConfig({
      url: "https://control.example",
      token: "t",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("returns not-ok when the body is not JSON", async () => {
    const res = await pullConfig({
      url: "https://control.example",
      token: "t",
      fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });

  // The timeout is the difference between a slow control plane and a slow
  // tenant. Without it, a hung endpoint hangs the app.
  it("gives up on a hanging control plane", async () => {
    const res = await pullConfig({
      url: "https://control.example",
      token: "t",
      timeoutMs: 20,
      fetchImpl: ((_u: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });
});

describe("normalizeFlags", () => {
  it("fills in a key the control plane omitted with the compiled value", () => {
    const flags = normalizeFlags({ forums: false });
    expect(flags.forums).toBe(false);
    expect(flags.dtc).toBe(compiled().dtc);
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it("ignores a key this build has never heard of", () => {
    const flags = normalizeFlags({ some_future_feature: true });
    expect("some_future_feature" in flags).toBe(false);
  });

  it("falls back for a non-boolean value rather than coercing it", () => {
    const flags = normalizeFlags({ forums: "yes", dtc: null, videos: 1 });
    expect(flags.forums).toBe(compiled().forums);
    expect(flags.dtc).toBe(compiled().dtc);
    expect(flags.videos).toBe(compiled().videos);
  });

  it("handles a null or garbage payload", () => {
    expect(normalizeFlags(null)).toEqual(compiled());
    expect(normalizeFlags("nonsense")).toEqual(compiled());
  });
});

describe("compiledConfig", () => {
  it("is always available and always complete", () => {
    const cfg = compiledConfig();
    expect(cfg.source).toBe("compiled");
    expect(Object.keys(cfg.features).sort()).toEqual([...FEATURE_KEYS].sort());
  });
});
