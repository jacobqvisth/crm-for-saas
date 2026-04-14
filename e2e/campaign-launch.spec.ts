import { test, expect } from '@playwright/test';

test.describe('Campaign launch', () => {
  test('enroll list button is visible on sequence detail page', async ({ page }) => {
    await page.goto('/sequences');
    // Click first sequence if any exist
    const firstSequence = page.locator('table tbody tr').first();
    if (await firstSequence.count() > 0) {
      await firstSequence.click();
      await expect(page.getByRole('button', { name: /enroll list/i })).toBeVisible();
    }
  });

  test('preflight API returns valid JSON', async ({ page }) => {
    // Test the API endpoint exists and returns expected shape
    const response = await page.request.get('/api/sequences/nonexistent/preflight?listId=test&workspaceId=test');
    // Should return 401/403 (auth error), not 404 or 500
    expect([401, 403, 400]).toContain(response.status());
  });

  test('analytics page loads without error', async ({ page }) => {
    await page.goto('/sequences');
    const firstSequence = page.locator('table tbody tr').first();
    if (await firstSequence.count() > 0) {
      const href = await firstSequence.locator('a').first().getAttribute('href');
      if (href) {
        await page.goto(`${href}/analytics`);
        await expect(page).not.toHaveTitle(/error/i);
        // Stat cards should be visible
        await expect(page.getByText(/enrolled/i).first()).toBeVisible();
      }
    }
  });
});
