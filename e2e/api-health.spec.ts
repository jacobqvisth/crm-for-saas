import { test, expect } from '@playwright/test';

test.describe('API Health Checks', () => {
  test('email tracking pixel endpoint responds (no auth required)', async ({ request }) => {
    // The open pixel should return 200 with a GIF, not 404 or 500
    // Use a fake ID — we expect 200 (with empty/default pixel) or 404, never 500
    const response = await request.get('/api/tracking/open/00000000-0000-0000-0000-000000000000');
    expect([200, 404]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });

  test('email click redirect endpoint does not crash', async ({ request }) => {
    const response = await request.get('/api/tracking/click/00000000-0000-0000-0000-000000000000', {
      maxRedirects: 0,
    });
    // Any response except 500 is acceptable — unknown IDs may return 400/404/redirect
    expect(response.status()).not.toBe(500);
  });

  test('cron: process-emails requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/process-emails');
    expect([401, 403]).toContain(response.status());
  });

  test('cron: check-replies requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/check-replies');
    expect([401, 403]).toContain(response.status());
  });

  test('cron: reset-daily-sends requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/reset-daily-sends');
    expect([401, 403]).toContain(response.status());
  });
});
