import { test, expect } from '@playwright/test';

test.describe('Smoke Tests — Public Pages', () => {
  test('login page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/login');
    await expect(page.locator('body')).toBeVisible();

    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('Download the React DevTools')
    );
    expect(critical).toEqual([]);
  });

  test('unauthenticated users are redirected to /login from /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login**', { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  test('protected routes all redirect to /login', async ({ page }) => {
    const routes = ['/contacts', '/companies', '/deals', '/sequences', '/lists', '/settings'];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    }
  });
});
