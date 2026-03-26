import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const STORAGE_STATE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Auth setup requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add SUPABASE_SERVICE_ROLE_KEY to your .env.local file (find it in Supabase Dashboard → Settings → API).'
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

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
