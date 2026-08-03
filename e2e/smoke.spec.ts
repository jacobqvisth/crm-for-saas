import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  // Derived from the filesystem, not typed out. The old hard-coded list here
  // named five sections and passed happily while /forums served its shell to
  // logged-out visitors — the test mirrored the same blind spot as the
  // middleware allow-list it was meant to verify. Now every section under
  // src/app/(dashboard) is checked, including ones added after this was written.
  const dashboardSections = readdirSync(
    join(__dirname, '..', 'src', 'app', '(dashboard)'),
    { withFileTypes: true },
  )
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);

  test('every dashboard section redirects to /login when signed out', async ({ page }) => {
    expect(dashboardSections.length).toBeGreaterThan(10);
    expect(dashboardSections).toContain('forums');

    for (const section of dashboardSections) {
      await page.goto(`/${section}`);
      await page.waitForURL('**/login**', { timeout: 10_000 });
      expect(page.url(), `/${section} should redirect to login`).toContain('/login');
      // The destination is preserved so a shared deep link survives sign-in.
      expect(decodeURIComponent(page.url())).toContain(`next=/${section}`);
    }
  });

  test('forums sub-pages redirect too, rather than showing an Unauthorized banner', async ({ page }) => {
    for (const path of ['/forums/answers', '/forums/gaps', '/forums/stats', '/forums/accounts']) {
      await page.goto(path);
      await page.waitForURL('**/login**', { timeout: 10_000 });
      await expect(page.getByText('Unauthorized')).toHaveCount(0);
    }
  });

  test('an API route answers 401 JSON instead of redirecting to HTML', async ({ request }) => {
    // Middleware must not swallow API calls — clients rely on the status.
    const res = await request.get('/api/forums/replies');
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' });
  });
});
