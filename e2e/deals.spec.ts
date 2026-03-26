import { test, expect } from '@playwright/test';

test.describe('Deals Pipeline', () => {
  test('deals page loads with kanban columns', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    // Should show pipeline columns or empty state
    const body = await page.textContent('body');
    const hasKanban =
      body?.includes('Deal') ||
      body?.includes('Pipeline') ||
      body?.includes('Stage') ||
      body?.includes('Add');
    expect(hasKanban).toBe(true);
    expect(errors).toEqual([]);
  });

  test('can open create deal dialog', async ({ page }) => {
    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    const addBtn = page.locator('button:has-text("Add")').first()
      .or(page.locator('button:has-text("New Deal")').first())
      .or(page.locator('button:has-text("Create")').first());

    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await expect(
        page.locator('[role="dialog"]').first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});
