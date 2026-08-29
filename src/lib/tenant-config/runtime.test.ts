import { afterEach, describe, expect, it, vi } from "vitest";
import { getTenant } from "@/config/tenants";

// peekFlags() is what middleware calls, and middleware runs on nearly every
// request. The property being pinned here is that it is SYNCHRONOUS and always
// answers: it must never be possible for a slow or dead control plane to add
// latency to, or block, an ordinary page load.

const savedUrl = process.env.CONTROL_PLANE_URL;
const savedToken = process.env.CONTROL_PLANE_TOKEN;

afterEach(async () => {
  if (savedUrl === undefined) delete process.env.CONTROL_PLANE_URL;
  else process.env.CONTROL_PLANE_URL = savedUrl;
  if (savedToken === undefined) delete process.env.CONTROL_PLANE_TOKEN;
  else process.env.CONTROL_PLANE_TOKEN = savedToken;
  const { __resetRuntimeFlags } = await import("./runtime");
  __resetRuntimeFlags();
  vi.restoreAllMocks();
});

describe("peekFlags", () => {
  it("returns compiled defaults on a cold start, without awaiting anything", async () => {
    const { peekFlags, __resetRuntimeFlags } = await import("./runtime");
    __resetRuntimeFlags();
    delete process.env.CONTROL_PLANE_URL;

    const flags = peekFlags();
    // Not a promise. If this ever becomes one, middleware starts blocking.
    expect(flags).not.toBeInstanceOf(Promise);
    expect(flags).toEqual(getTenant().features);
  });

  it("answers instantly even when the control plane hangs forever", async () => {
    const { peekFlags, __resetRuntimeFlags } = await import("./runtime");
    __resetRuntimeFlags();
    process.env.CONTROL_PLANE_URL = "https://control.example";
    process.env.CONTROL_PLANE_TOKEN = "t";

    // A fetch that never settles. peekFlags must not care.
    vi.stubGlobal("fetch", () => new Promise(() => {}));

    const started = Date.now();
    const flags = peekFlags();
    const elapsed = Date.now() - started;

    expect(flags).toEqual(getTenant().features);
    expect(elapsed).toBeLessThan(50);
  });

  it("does not start a second refresh while one is in flight", async () => {
    const { peekFlags, __resetRuntimeFlags } = await import("./runtime");
    __resetRuntimeFlags();
    process.env.CONTROL_PLANE_URL = "https://control.example";
    process.env.CONTROL_PLANE_TOKEN = "t";

    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    peekFlags();
    peekFlags();
    peekFlags();

    // One in-flight refresh, not three. Middleware runs on every request, so
    // without this guard a cold instance would stampede the control plane.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves pulled values once a refresh has landed", async () => {
    const { peekFlags, __resetRuntimeFlags, __peekMemo } = await import("./runtime");
    __resetRuntimeFlags();
    process.env.CONTROL_PLANE_URL = "https://control.example";
    process.env.CONTROL_PLANE_TOKEN = "t";

    const overridden = { ...getTenant().features, forums: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ features: overridden }), { status: 200 })),
    );

    // First call: cold, serves compiled and kicks off the refresh.
    expect(peekFlags().forums).toBe(true);

    // Let the background refresh settle.
    await vi.waitFor(() => expect(__peekMemo()).not.toBeNull());

    // Second call: the memo now answers.
    expect(peekFlags().forums).toBe(false);
  });

  it("keeps serving the last good value when a later refresh fails", async () => {
    const { peekFlags, __resetRuntimeFlags, __peekMemo } = await import("./runtime");
    __resetRuntimeFlags();
    process.env.CONTROL_PLANE_URL = "https://control.example";
    process.env.CONTROL_PLANE_TOKEN = "t";

    const overridden = { ...getTenant().features, reviews: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ features: overridden }), { status: 200 })),
    );
    peekFlags();
    await vi.waitFor(() => expect(__peekMemo()).not.toBeNull());
    expect(peekFlags().reviews).toBe(false);

    // Control plane now dies. The memo is still fresh, so nothing refetches,
    // and even once it goes stale the old value stands rather than reverting.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    expect(peekFlags().reviews).toBe(false);
  });
});
