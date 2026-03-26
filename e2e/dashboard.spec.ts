import { test, expect } from '@playwright/test';

function trackErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('Dashboard', () => {
  test('loads without console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Internal Server Error');

    const critical = errors.filter(e => !e.includes('favicon'));
    expect(critical).toEqual([]);
  });

  test('sidebar links navigate correctly', async ({ page }) => {
    await page.goto('/dashboard');
    const navLinks = [
      { text: 'Contacts', url: '/contacts' },
      { text: 'Companies', url: '/companies' },
      { text: 'Deals', url: '/deals' },
      { text: 'Sequences', url: '/sequences' },
      { text: 'Lists', url: '/lists' },
    ];
    for (const link of navLinks) {
      const navItem = page.locator(`nav >> text=${link.text}`).first();
      if (await navItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navItem.click();
        await page.waitForURL(`**${link.url}**`, { timeout: 10_000 });
        expect(page.url()).toContain(link.url);
      }
    }
  });
});

test.describe('All Pages Load Without Crashes', () => {
  const pages = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Contacts', path: '/contacts' },
    { name: 'Companies', path: '/companies' },
    { name: 'Deals', path: '/deals' },
    { name: 'Sequences', path: '/sequences' },
    { name: 'Lists', path: '/lists' },
    { name: 'Templates', path: '/templates' },
    { name: 'Settings', path: '/settings' },
  ];

  for (const p of pages) {
    test(`${p.name} page loads`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');

      const body = await page.textContent('body');
      expect(body).not.toContain('Application error');
      expect(body).not.toContain('500');

      const critical = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('Download the React DevTools') &&
        !e.includes('Third-party cookie')
      );
      expect(critical).toEqual([]);
    });
  }
});
