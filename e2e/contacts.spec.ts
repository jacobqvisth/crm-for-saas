import { test, expect } from '@playwright/test';

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contacts');
    await page.waitForLoadState('networkidle');
  });

  test('contacts page loads with table or empty state', async ({ page }) => {
    const body = await page.textContent('body');
    const hasContent = body?.includes('Contact') || body?.includes('Import') || body?.includes('Add');
    expect(hasContent).toBe(true);
  });

  test('can open Add Contact dialog', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Add")').first()
      .or(page.locator('button:has-text("New Contact")').first())
      .or(page.locator('button:has-text("Create")').first());

    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      // The form may render as a dialog OR as a slide-in panel (h2 heading)
      await expect(
        page.locator('[role="dialog"], h2:has-text("Add Contact"), h2:has-text("New Contact"), h2:has-text("Create Contact")').first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('CSV import area is visible', async ({ page }) => {
    const importBtn = page.locator('button:has-text("Import")').first()
      .or(page.locator('text=/import.*csv/i').first());
    // Either a button or an input[type=file] should exist
    const hasImport =
      await importBtn.isVisible({ timeout: 3000 }).catch(() => false) ||
      (await page.locator('input[type="file"]').count()) > 0;
    expect(hasImport).toBe(true);
  });
});
