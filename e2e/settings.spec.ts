import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
  });

  test('"Connect Gmail" flow is accessible', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Should see Gmail section or Email settings
    const body = await page.textContent('body');
    const hasGmail = body?.includes('Gmail') || body?.includes('Email') || body?.includes('Connect');
    expect(hasGmail).toBe(true);
  });
});
