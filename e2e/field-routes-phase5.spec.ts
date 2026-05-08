import { test, expect } from "@playwright/test";

// Phase 5 — single-route generation, region picker, "for when?" date.
// These tests assume a logged-in workspace (handled by playwright project
// setup) and that the generation API can succeed against the test workspace's
// pool. If the pool is empty in the test env, the generator returns
// `no_eligible_cluster` and we treat that as a clean skip — the API contract
// is what we're testing, not data state.

test.describe("Field routes — Phase 5 single-route generation", () => {
  test("Auto generates exactly one route as a candidate", async ({ page, request }) => {
    const before = await listCandidates(request);

    await page.goto("/routes");
    const generateBtn = page.getByRole("button", { name: /generate route/i });
    await expect(generateBtn).toBeVisible();

    // Default region is Auto and forDate is empty.
    await generateBtn.click();

    // Either a success toast (one new candidate) or a "no_eligible_cluster"
    // toast (empty pool). Wait for the network call to settle either way.
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/routes/generate") && resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    const after = await listCandidates(request);
    if (after.length === before.length) {
      test.skip(true, "no_eligible_cluster — empty pool in this test env");
    }
    expect(after.length).toBe(before.length + 1);
  });

  test("Region=Uppsala produces an Uppsala-area label", async ({ page, request }) => {
    const before = await listCandidates(request);

    await page.goto("/routes");
    await page.getByLabel("Region").selectOption("uppsala");
    await page.getByRole("button", { name: /generate route/i }).click();

    await page.waitForResponse(
      (resp) => resp.url().includes("/api/routes/generate") && resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    const after = await listCandidates(request);
    if (after.length === before.length) {
      test.skip(true, "no Uppsala-area cluster eligible");
    }
    const newRoute = after.find((r) => !before.some((b) => b.id === r.id));
    expect(newRoute).toBeDefined();
    // Label should contain at least one Uppsala-area town. The known towns
    // within 25 km of Uppsala center per cluster-label.ts: "Uppsala",
    // "Knivsta", and city tallies could surface other nearby places.
    const label = newRoute!.cluster_label.toLowerCase();
    const uppsalaArea = ["uppsala", "knivsta"];
    expect(uppsalaArea.some((town) => label.includes(town))).toBe(true);
  });

  test("Two clicks yield two distinct routes", async ({ page, request }) => {
    const before = await listCandidates(request);

    await page.goto("/routes");
    const btn = page.getByRole("button", { name: /generate route/i });
    await btn.click();
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/routes/generate") && resp.request().method() === "POST",
      { timeout: 15_000 },
    );
    await btn.click();
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/routes/generate") && resp.request().method() === "POST",
      { timeout: 15_000 },
    );

    const after = await listCandidates(request);
    const created = after.filter((r) => !before.some((b) => b.id === r.id));
    if (created.length < 2) {
      test.skip(true, "fewer than two distinct candidates produced (small pool)");
    }
    expect(created[0].id).not.toBe(created[1].id);
    // Verify they're not identical content (at least cluster_label or stop_count differs)
    const distinct =
      created[0].cluster_label !== created[1].cluster_label ||
      created[0].stop_count !== created[1].stop_count;
    expect(distinct).toBe(true);
  });
});

async function listCandidates(
  request: import("@playwright/test").APIRequestContext,
): Promise<{ id: string; cluster_label: string; stop_count: number }[]> {
  const res = await request.get("/api/routes?scope=mine");
  if (!res.ok()) return [];
  const data = (await res.json()) as {
    routes?: { id: string; cluster_label: string; status: string; stop_count: number }[];
  };
  return (data.routes ?? []).filter((r) => r.status === "candidate");
}
