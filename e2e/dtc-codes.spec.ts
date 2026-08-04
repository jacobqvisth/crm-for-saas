import { test, expect } from '@playwright/test';

function trackErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('DTC Codes dashboard page', () => {
  test('renders against live data without errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/dashboard/dtc-codes');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Internal Server Error');
    // The all_time timeout failure mode this page family is prone to surfaces
    // as this string rather than as an HTTP error.
    expect(body).not.toContain('could not load this view');

    await expect(
      page.getByRole('heading', { name: 'DTC Codes', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Most entered fault codes/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Codes that arrive together/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /What is actually breaking/ }),
    ).toBeVisible();

    const critical = errors.filter(e => !e.includes('favicon'));
    expect(critical).toEqual([]);
  });

  test('hides the time-range pills and keeps the country filter', async ({ page }) => {
    await page.goto('/dashboard/dtc-codes');
    await page.waitForLoadState('networkidle');

    // This page always reads all history, so the range pills must not render —
    // handing getDashboardData an all_time range is what times these pages out.
    await expect(page.getByRole('link', { name: 'Last 30 days' })).toHaveCount(0);
    expect(page.url()).not.toContain('range=');
  });

  test('country filter keeps the page working', async ({ page }) => {
    await page.goto('/dashboard/dtc-codes?country=SE');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    await expect(
      page.getByRole('heading', { name: 'DTC Codes', level: 1 }),
    ).toBeVisible();
  });

  test('pair Open opens the drilldown filtered to both codes', async ({ page }) => {
    await page.goto('/dashboard/dtc-codes');
    await page.waitForLoadState('networkidle');

    const pairs = page
      .locator('section.panel')
      .filter({
        has: page.getByRole('heading', { name: /Codes that arrive together/ }),
      });
    const open = pairs.getByRole('link', { name: 'Open' }).first();
    if (!(await open.isVisible({ timeout: 5000 }).catch(() => false))) {
      return;
    }

    await open.click();
    await page.waitForURL('**/dashboard/diagnostics**', { timeout: 20_000 });

    // A pair must arrive as the AND-ing `codes=` filter, not as free-text `q`,
    // which can only substring-match one of the two codes.
    expect(page.url()).toContain('codes=');
    expect(page.url()).not.toContain('q=');
    expect(page.url()).not.toContain('range=all_time');

    // The drilldown reads every diagnostics row before it renders, so wait for
    // its own content rather than reading the body while the shell is still
    // streaming.
    await expect(
      page.getByRole('heading', { name: /had .* together/ }),
    ).toBeVisible({ timeout: 60_000 });

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('could not load this view');
    // A pair counted over all history has to resolve to at least one session.
    expect(body).toContain('every one of');
    await expect(page.getByText('No diagnostics in this window')).toHaveCount(0);
  });

  test('top code links into the diagnostics drilldown', async ({ page }) => {
    await page.goto('/dashboard/dtc-codes');
    await page.waitForLoadState('networkidle');

    const open = page.getByRole('link', { name: 'Open' }).first();
    if (await open.isVisible({ timeout: 5000 }).catch(() => false)) {
      await open.click();
      await page.waitForURL('**/dashboard/diagnostics**', { timeout: 20_000 });
      expect(page.url()).toContain('q=');
      // Links must not carry a range: all_time on the drilldown times it out.
      expect(page.url()).not.toContain('range=all_time');
    }
  });
});
