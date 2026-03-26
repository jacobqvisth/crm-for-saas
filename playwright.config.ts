import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local from the worktree or fall back to the main repo root
// Worktree is at .claude/worktrees/<name>/ so main repo root is 3 levels up
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });
}

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
    {
      // API health checks don't require auth — included in smoke run
      name: 'api',
      testMatch: /.*api-health\.spec\.ts/,
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
