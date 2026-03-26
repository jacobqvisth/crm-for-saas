import { test as teardown } from '@playwright/test';

teardown('cleanup auth state', async () => {
  // Test user stays in Supabase for reuse across sessions
});
