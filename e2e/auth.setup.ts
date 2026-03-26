import { test as setup, expect } from '@playwright/test';

const STORAGE_STATE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    throw new Error('CRON_SECRET is not set in .env.local — required for E2E auth');
  }

  // Hit the e2e-login route which creates/ensures the test user and signs them in
  // server-side, setting the correct auth cookies on the redirect response.
  await page.goto(`${baseURL}/api/e2e-login?secret=${cronSecret}`);

  // Should redirect to /dashboard after successful login
  await page.waitForURL('**/dashboard**', { timeout: 20_000 });

  // Verify we're actually authenticated (not bounced back to login)
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    throw new Error(`Auth failed — redirected to login instead of dashboard. URL: ${currentUrl}`);
  }

  await expect(page.locator('body')).toBeVisible();

  // Save the authenticated browser state (cookies) for all subsequent tests
  await page.context().storageState({ path: STORAGE_STATE });
});
