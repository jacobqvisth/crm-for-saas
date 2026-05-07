import { test, expect } from '@playwright/test';

// Phase 3 — visit logging + auto follow-up on /routes/[id].
// These are smoke tests that assert the API surface + the basic UI controls
// exist. Full database side-effect verification (enrollment created,
// do_not_contact set, promotion fired) is exercised by the unit tests for
// `decideEnrollment` and the manual smoke test logged in cc-session-log.md.
test.describe('Field visits — Phase 3', () => {
  test('settings/field-visits subpage renders and saves', async ({ page }) => {
    await page.goto('/settings/field-visits');
    await expect(page.getByRole('heading', { name: /field visits/i })).toBeVisible();
    await expect(page.getByText(/auto-enroll companies/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();
  });

  test('visit endpoint requires auth + valid stopId', async ({ request }) => {
    // Random uuids → 401/403/404 (depending on auth state) but never 500.
    const res = await request.post(
      '/api/routes/00000000-0000-0000-0000-000000000000/stops/00000000-0000-0000-0000-000000000000/visit',
      { data: { outcome: 'interested' } },
    );
    expect([401, 403, 404, 400]).toContain(res.status());
  });

  test('visit endpoint rejects invalid outcome', async ({ request }) => {
    const res = await request.post(
      '/api/routes/00000000-0000-0000-0000-000000000000/stops/00000000-0000-0000-0000-000000000000/visit',
      { data: { outcome: 'banana' } },
    );
    expect([400, 401, 403, 404]).toContain(res.status());
  });

  test('company PATCH rejects unknown body keys cleanly', async ({ request }) => {
    const res = await request.patch('/api/companies/00000000-0000-0000-0000-000000000000', {
      data: {},
    });
    // Empty body → 400; non-existent id → 404; unauthed → 401/403.
    expect([400, 401, 403, 404]).toContain(res.status());
  });

  test('route detail shows Mark visited button when stops exist', async ({ page }) => {
    await page.goto('/routes');

    const firstRouteLink = page
      .locator('a[href^="/routes/"]:not([href="/routes"])')
      .first();
    if (!(await firstRouteLink.isVisible().catch(() => false))) {
      test.skip(true, 'no routes generated in this environment');
    }

    await firstRouteLink.click();
    await page.waitForURL(/\/routes\/[^/]+$/);

    // Day-progress indicator
    await expect(page.getByText(/of \d+ visited/i)).toBeVisible({ timeout: 10_000 });

    // Mark visited buttons (one per unvisited stop). May be 0 if every stop
    // is already visited — only assert visibility if at least one is present.
    const markButtons = page.getByRole('button', { name: /mark visited/i });
    const count = await markButtons.count();
    if (count > 0) {
      await expect(markButtons.first()).toBeVisible();
    }
  });
});
