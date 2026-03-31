import { test, expect } from '@playwright/test';

test.describe('Inbox API Smoke Tests', () => {
  test('GET /api/inbox returns 200 with array (requires auth)', async ({ request }) => {
    const response = await request.get('/api/inbox');
    // Without auth returns 401; if auth is present returns 200 with array
    expect([200, 401]).toContain(response.status());
    if (response.status() === 200) {
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    }
  });

  test('GET /api/inbox/unread-count returns 200 with count (requires auth)', async ({ request }) => {
    const response = await request.get('/api/inbox/unread-count');
    expect([200, 401]).toContain(response.status());
    if (response.status() === 200) {
      const data = await response.json();
      expect(typeof data.count).toBe('number');
    }
  });

  test('PATCH /api/inbox/nonexistent-id returns 401 or 404 without auth', async ({ request }) => {
    const response = await request.patch('/api/inbox/00000000-0000-0000-0000-000000000000', {
      data: { is_read: true },
    });
    expect([401, 404]).toContain(response.status());
  });
});
