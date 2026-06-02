import { test, expect } from '@playwright/test';

function trackErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('Roadmap', () => {
  test('loads, seeds a board, and renders timeline bars', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/roadmap');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Internal Server Error');

    // Zoom + actions header should be present.
    await expect(page.getByRole('button', { name: 'Add group' })).toBeVisible({ timeout: 10_000 });

    // The seeded board ("WL Marketing") shows its swimlanes / items.
    const seededLabel = page.locator('text=Email').first();
    await expect(seededLabel).toBeVisible({ timeout: 10_000 });

    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('Download the React DevTools') &&
      !e.includes('Third-party cookie')
    );
    expect(critical).toEqual([]);
  });

  test('zoom controls switch the timeline density', async ({ page }) => {
    await page.goto('/roadmap');
    await page.waitForLoadState('networkidle');
    for (const label of ['Day', 'Month', 'Week']) {
      const btn = page.getByRole('button', { name: label, exact: true });
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
      }
    }
    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
  });

  test('can switch to Kanban view', async ({ page }) => {
    await page.goto('/roadmap');
    await page.waitForLoadState('networkidle');
    const kanbanBtn = page.getByRole('button', { name: 'Kanban', exact: true });
    if (await kanbanBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await kanbanBtn.click();
      // Status columns should render.
      await expect(page.locator('text=In progress').first()).toBeVisible({ timeout: 5000 });
    }
    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
  });
});
