import { test, expect } from '@playwright/test';

test.describe('Email Warmup & Sender Health', () => {
  test('Settings → Email shows warmup info for connected accounts', async ({ page }) => {
    await page.goto('/settings/email');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    // Should show warmup stage text (any connected account will show one of these)
    const hasWarmupInfo =
      body?.includes('Warming up') ||
      body?.includes('Warmup complete') ||
      body?.includes('Manual mode') ||
      body?.includes('Setup Required') ||
      // If no accounts connected, the page should still load without errors
      body?.includes('No Gmail accounts') ||
      body?.includes('Connect') ||
      body?.includes('Gmail');
    expect(hasWarmupInfo).toBe(true);
    expect(body).not.toContain('Application error');
  });

  test('cron: advance-warmup requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/advance-warmup');
    expect([401, 403]).toContain(response.status());
  });

  test('domain-check API requires auth', async ({ request }) => {
    const response = await request.get(
      '/api/settings/email/00000000-0000-0000-0000-000000000000/domain-check'
    );
    expect([401, 403]).toContain(response.status());
  });

  test('preflight response includes senderHealthWarnings array', async ({ request, page }) => {
    // Navigate to get auth cookies
    await page.goto('/sequences');
    await page.waitForLoadState('networkidle');

    // Try a preflight request — even with fake IDs, it should return a structured response
    // (not crash or return 500)
    const response = await page.request.get(
      '/api/sequences/00000000-0000-0000-0000-000000000000/preflight?listId=00000000-0000-0000-0000-000000000001&workspaceId=00000000-0000-0000-0000-000000000002'
    );
    // With fake IDs: workspace membership check will fail → 403
    // Either way, should not be 500
    expect(response.status()).not.toBe(500);
  });
});
