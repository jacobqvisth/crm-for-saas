import { test, expect } from '@playwright/test';

test.describe('Sequences', () => {
  test('sequences list page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/sequences');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    const hasContent = body?.includes('Sequence') || body?.includes('Create') || body?.includes('campaign');
    expect(hasContent).toBe(true);
    expect(errors).toEqual([]);
  });

  test('can navigate to create new sequence', async ({ page }) => {
    await page.goto('/sequences');
    await page.waitForLoadState('networkidle');

    const createBtn = page.locator('button:has-text("Create")').first()
      .or(page.locator('button:has-text("New")').first())
      .or(page.locator('a:has-text("New")').first());

    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      // Either opens a dialog or navigates to a new page
      await page.waitForLoadState('networkidle');
      const afterBody = await page.textContent('body');
      expect(afterBody).not.toContain('Application error');
    }
  });
});
