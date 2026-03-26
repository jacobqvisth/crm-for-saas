---
type: cc-prompt
phase: QA
description: Playwright E2E test suite for the Wrenchlane CRM
created: 2026-03-26
---

# Claude Code Prompt — Phase QA: Automated E2E Testing with Playwright

> Paste this entire prompt into Claude Code (Sonnet, Code mode) with the local folder `/Users/jacobqvisth/crm-for-saas/` open.

---

## Context

You are adding automated E2E (end-to-end) testing to the Wrenchlane CRM. Phases 1–9 are complete and deployed. The app is live at https://crm-for-saas.vercel.app.

Read the project conventions before writing anything:
- `CLAUDE.md` — architecture rules, RLS, route structure, coding conventions

**Stack:** Next.js 16 (App Router, TypeScript, Tailwind CSS 4) + Supabase + Gmail API + Inngest + Vercel
**Production URL:** `https://crm-for-saas.vercel.app`
**Supabase project:** `wdgiwuhehqpkhpvdzzzl`

**What exists in the app:**

*Routes (note: NOT prefixed with /dashboard):*
- `/login` — login page (Supabase Google OAuth)
- `/dashboard` — main dashboard with reports/charts
- `/contacts` — contacts list + add/edit/delete + CSV import
- `/companies` — companies list + create/edit
- `/deals` — Kanban pipeline board
- `/sequences` — email sequence builder (Lemlist-style)
- `/lists` — contact lists + smart lists
- `/templates` — email templates
- `/settings` — workspace settings, Gmail connection

*Key API routes:*
- `POST /api/auth/gmail/callback` — Gmail OAuth callback
- `GET /api/track/open/[id]` — email open pixel (returns 1x1 PNG)
- `GET /api/track/click/[id]` — email click redirect
- `GET /api/track/unsubscribe/[token]` — unsubscribe handler
- `POST /api/contacts/import` — CSV import
- `GET /api/cron/process-emails` — requires CRON_SECRET
- `GET /api/cron/check-replies` — requires CRON_SECRET
- `POST /api/cron/reset-daily-sends` — requires CRON_SECRET

*Environment variables already present:*
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`

---

## Goal

Create a Playwright E2E test suite that:
1. Runs with `npm run test:e2e` against production
2. Runs smoke tests (no auth) with `npm run test:e2e:smoke`
3. Handles Supabase auth via service role (bypasses Google OAuth)
4. Generates an HTML report with screenshots on failure
5. Covers all critical CRM workflows

---

## Step 1: Install & Configure Playwright

```bash
npm init playwright@latest -- --yes --quiet --browser=chromium
npx playwright install chromium
npm install -D dotenv
```

### Create `playwright.config.ts` in the project root:

```typescript
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const baseURL = process.env.TEST_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /.*\.teardown\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'smoke',
      testMatch: /.*smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: baseURL.includes('localhost') ? {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  } : undefined,
});
```

### Add scripts to `package.json`:

```json
"test:e2e": "npx playwright test",
"test:e2e:ui": "npx playwright test --ui",
"test:e2e:smoke": "npx playwright test --project=smoke",
"test:e2e:report": "npx playwright show-report"
```

### Add to `.gitignore`:

```
/e2e/.auth/
/test-results/
/playwright-report/
/blob-report/
```

---

## Step 2: Auth Setup

The app uses Google OAuth which can't be automated. We inject a Supabase session using the service role key.

### Create `e2e/auth.setup.ts`:

```typescript
import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const STORAGE_STATE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const testEmail = process.env.TEST_USER_EMAIL || 'e2e-test@wrenchlane-test.local';

  // Find or create test user
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let testUser = existingUsers?.users?.find(u => u.email === testEmail);

  if (!testUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: 'e2e-test-password-crm-2026!',
      email_confirm: true,
      user_metadata: { full_name: 'E2E Test User' },
    });
    if (error) throw new Error(`Failed to create test user: ${error.message}`);
    testUser = data.user;
  }

  // Generate magic link to authenticate without Google OAuth
  const { data: sessionData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: testEmail,
  });

  if (linkError || !sessionData?.properties?.action_link) {
    throw new Error(`Failed to generate magic link: ${linkError?.message}`);
  }

  await page.goto(sessionData.properties.action_link);

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard**', { timeout: 20_000 });
  await expect(page.locator('body')).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
```

### Create `e2e/auth.teardown.ts`:

```typescript
import { test as teardown } from '@playwright/test';
teardown('cleanup auth state', async () => {
  // Test user stays in Supabase for reuse across sessions
});
```

### Create the auth directory:

```bash
mkdir -p e2e/.auth
echo '{}' > e2e/.auth/user.json
```

### Add to `.env.local`:
```
TEST_USER_EMAIL=e2e-test@wrenchlane-test.local
```
(SUPABASE_SERVICE_ROLE_KEY should already be present from Phase 4+)

---

## Step 3: Smoke Tests (No Auth)

### Create `e2e/smoke.spec.ts`:

```typescript
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
```

---

## Step 4: Dashboard & Navigation Tests

### Create `e2e/dashboard.spec.ts`:

```typescript
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
        !e.includes('favicon') && !e.includes('Download the React DevTools') && !e.includes('Third-party cookie')
      );
      expect(critical).toEqual([]);
    });
  }
});
```

---

## Step 5: Contacts Tests

### Create `e2e/contacts.spec.ts`:

```typescript
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
      await expect(
        page.locator('[role="dialog"]').first()
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
```

---

## Step 6: Deals Pipeline Tests

### Create `e2e/deals.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Deals Pipeline', () => {
  test('deals page loads with kanban columns', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    // Should show pipeline columns or empty state
    const body = await page.textContent('body');
    const hasKanban =
      body?.includes('Deal') ||
      body?.includes('Pipeline') ||
      body?.includes('Stage') ||
      body?.includes('Add');
    expect(hasKanban).toBe(true);
    expect(errors).toEqual([]);
  });

  test('can open create deal dialog', async ({ page }) => {
    await page.goto('/deals');
    await page.waitForLoadState('networkidle');

    const addBtn = page.locator('button:has-text("Add")').first()
      .or(page.locator('button:has-text("New Deal")').first())
      .or(page.locator('button:has-text("Create")').first());

    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.click();
      await expect(
        page.locator('[role="dialog"]').first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});
```

---

## Step 7: Sequences Tests

### Create `e2e/sequences.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Sequences', () => {
  test('sequences list page loads', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/sequences');
    await page.waitForLoadState('networkidle');

    const body = await page.textContent('body');
    const hasContent = body?.includes('Sequence') || body?.includes('Create') || body?.includes('campaign');
    expect(hasContent).toBe(true);
    expect(errors).toEqual([]);
  });

  test('can navigate to create new sequence', async ({ page }) => {
    await page.goto('/sequences');
    await page.waitForLoadState('networkidle');

    const createBtn = page.locator('button:has-text("Create")').first()
      .or(page.locator('button:has-text("New")').first())
      .or(page.locator('a:has-text("New")').first());

    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      // Either opens a dialog or navigates to a new page
      await page.waitForLoadState('networkidle');
      const afterBody = await page.textContent('body');
      expect(afterBody).not.toContain('Application error');
    }
  });
});
```

---

## Step 8: Settings & Gmail Tests

### Create `e2e/settings.spec.ts`:

```typescript
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
```

---

## Step 9: API Health Check Tests

### Create `e2e/api-health.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('API Health Checks', () => {
  test('email tracking pixel endpoint responds (no auth required)', async ({ request }) => {
    // The open pixel should return 200 with a GIF, not 404 or 500
    // Use a fake ID — we expect 200 (with empty/default pixel) or 404, never 500
    const response = await request.get('/api/track/open/00000000-0000-0000-0000-000000000000');
    expect([200, 404]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });

  test('email click redirect endpoint does not crash', async ({ request }) => {
    const response = await request.get('/api/track/click/00000000-0000-0000-0000-000000000000', {
      maxRedirects: 0,
    });
    // Expect a redirect (302) or 404 for unknown ID, but NOT 500
    expect([301, 302, 303, 307, 308, 404]).toContain(response.status());
    expect(response.status()).not.toBe(500);
  });

  test('contacts API requires auth', async ({ request }) => {
    const response = await request.get('/api/contacts');
    expect([401, 403, 404]).toContain(response.status());
  });

  test('cron: process-emails requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/process-emails');
    expect([401, 403]).toContain(response.status());
  });

  test('cron: check-replies requires CRON_SECRET', async ({ request }) => {
    const response = await request.get('/api/cron/check-replies');
    expect([401, 403]).toContain(response.status());
  });
});
```

---

## Step 10: Run the Tests & Fix Issues

### Run smoke tests first (no auth):
```bash
npm run test:e2e:smoke
```

Fix any failures before running the full suite.

### Run full suite against production:
```bash
TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e
```

### View the report:
```bash
npm run test:e2e:report
```

---

## Step 11: Final Verification Checklist

- [ ] `npm run test:e2e:smoke` passes (public pages, redirects)
- [ ] `npm run test:e2e` passes against production URL
- [ ] HTML report generates in `playwright-report/`
- [ ] Screenshots captured on failures
- [ ] `e2e/.auth/user.json` is in `.gitignore` (do NOT commit session tokens)
- [ ] All four `test:e2e` scripts present in `package.json`
- [ ] `npm run build && npm run lint` pass

**Expected test count: ~30–40 tests across 8 spec files.**

---

## Important Notes

1. **E2E test user**: The test user (`e2e-test@wrenchlane-test.local`) will be created in the production Supabase project and assigned a workspace via the normal onboarding flow. If onboarding creates a workspace automatically on first login, the E2E session will have a valid workspace. If not, you may need to seed a workspace — check after auth setup runs.

2. **Workspace context**: The CRM uses `workspaceId` context throughout. If the test user has no workspace, most pages will render empty or show errors. If this happens, add a setup step that creates a workspace row for the test user via the Supabase service role client.

3. **RLS in tests**: The test user will only see their own data (RLS is enforced). Tests should be resilient to empty data (no contacts, no deals, etc.) — they're testing structure and errors, not data.

4. **Don't test Inngest flows**: Email sequence execution runs through Inngest and is async. Don't try to E2E test that sequences actually send — only test that the UI for creating them works.

5. **Track endpoint**: The `/api/track/open/[id]` endpoint must always return 200. If it 404s for unknown IDs, that's acceptable — just not 500. This is a critical production endpoint that gets hit by email clients.

6. **Commit everything**: After tests pass, commit all files including `playwright.config.ts`, `e2e/` directory, and updated `package.json`. Push to main.

---

## Deliverable

When this phase is complete:
- `npm run test:e2e:smoke` runs in ~5 seconds, no auth needed
- `TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e` runs ~35 tests and verifies all critical CRM flows work in production
- Any future deploy can be verified in under 2 minutes
- Failures produce screenshots and HTML reports for fast debugging
