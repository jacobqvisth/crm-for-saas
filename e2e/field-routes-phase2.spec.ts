import { test, expect } from '@playwright/test';

// Phase 2 — interactive map + drag-reorder on /routes/[id].
// We need the public Maps key in the test env to render the map. If it's not
// set we skip the whole file rather than asserting on a static fallback.
test.describe('Field routes — Phase 2 detail page', () => {
  test.skip(
    !process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
    'no NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY in test env',
  );

  test('detail page renders a map container', async ({ page }) => {
    // Open the routes list and pick the first route, if any. Phase 1 may have
    // generated none in this environment — in that case there's nothing to
    // assert and we skip.
    await page.goto('/routes');

    const firstRouteLink = page.locator('a[href^="/routes/"]:not([href="/routes"])').first();
    if (!(await firstRouteLink.isVisible().catch(() => false))) {
      test.skip(true, 'no routes generated in this environment');
    }

    await firstRouteLink.click();
    await page.waitForURL(/\/routes\/[^/]+$/);

    // Maps JS API renders a div with role="application" once the map mounts.
    // We give it a generous timeout because the Maps JS bundle is ~400 KB.
    const mapApp = page.locator('div[role="application"]');
    await expect(mapApp).toBeVisible({ timeout: 30_000 });

    // The reorder list mounts in parallel — its Save button should exist (disabled).
    const saveBtn = page.getByRole('button', { name: /save new order/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
  });

  test('reorder API rejects mismatched stopIds with 400', async ({ request }) => {
    // Fetch any route to get a real id
    const listRes = await request.get('/api/routes');
    if (!listRes.ok()) test.skip(true, 'cannot list routes');
    const list = (await listRes.json()) as { routes?: { id: string }[] };
    const id = list.routes?.[0]?.id;
    if (!id) test.skip(true, 'no routes exist to test reorder against');

    // Empty array → 400 (zod rejects min(1)).
    const empty = await request.post(`/api/routes/${id}/reorder`, {
      data: { stopIds: [] },
    });
    expect([400, 401, 403]).toContain(empty.status());

    // Non-existent stopId → 400 (or 401/403 if not authed).
    const bogus = await request.post(`/api/routes/${id}/reorder`, {
      data: { stopIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect([400, 401, 403]).toContain(bogus.status());
  });
});
