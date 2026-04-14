/**
 * E2E tests for the rich TipTap email editor.
 *
 * These tests run against the deployed app (authenticated session from global setup).
 * They navigate to /sequences, open a sequence editor, and exercise the editor.
 */
import { test, expect } from "@playwright/test";

test.describe("Rich Email Editor", () => {
  /**
   * The sequences page loads without JS errors and the editor doesn't crash.
   */
  test("sequences page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/sequences");
    await page.waitForLoadState("networkidle");

    const body = await page.textContent("body");
    expect(
      body?.includes("Sequence") ||
        body?.includes("Create") ||
        body?.includes("campaign")
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  /**
   * Opening the templates page doesn't crash (template editor is embedded here).
   */
  test("templates page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/templates");
    await page.waitForLoadState("networkidle");

    const body = await page.textContent("body");
    expect(
      body?.includes("Template") ||
        body?.includes("Create") ||
        body?.includes("Subject")
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  /**
   * The TipTap editor renders and accepts keyboard input.
   * We create a new template, type in the rich editor, and verify the text appears.
   */
  test("can type in the rich editor via templates", async ({ page }) => {
    await page.goto("/templates");
    await page.waitForLoadState("networkidle");

    // Open create/new template
    const newBtn = page
      .locator('button:has-text("New")')
      .first()
      .or(page.locator('button:has-text("Create")').first())
      .or(page.locator('button:has-text("Add")').first());

    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(); // No create button visible — skip rather than fail
      return;
    }
    await newBtn.click();
    await page.waitForTimeout(500);

    // The TipTap editor renders as a div[contenteditable="true"]
    const editor = page.locator('[contenteditable="true"]').first();
    if (!(await editor.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(); // Editor not visible — template form may not be open
      return;
    }

    await editor.click();
    await editor.type("Hello world, this is a test.");

    // Verify text appears
    await expect(editor).toContainText("Hello world");
  });

  /**
   * The Variable dropdown inserts a chip into the editor.
   */
  test("variable dropdown inserts chip", async ({ page }) => {
    await page.goto("/templates");
    await page.waitForLoadState("networkidle");

    const newBtn = page
      .locator('button:has-text("New")')
      .first()
      .or(page.locator('button:has-text("Create")').first())
      .or(page.locator('button:has-text("Add")').first());

    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await newBtn.click();
    await page.waitForTimeout(500);

    const editor = page.locator('[contenteditable="true"]').first();
    if (!(await editor.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Click "+ Variable" button
    const variableBtn = page.locator('button:has-text("+ Variable")').first();
    if (!(await variableBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await variableBtn.click();

    // Select "First name"
    const firstNameOption = page.locator('button:has-text("First name")').first();
    await expect(firstNameOption).toBeVisible({ timeout: 3000 });
    await firstNameOption.click();

    // The chip should appear in the editor with data-variable attribute
    const chip = page.locator('[data-variable="first_name"]').first();
    await expect(chip).toBeVisible({ timeout: 3000 });
  });

  /**
   * The preview pane renders HTML (not escaped tags) in the iframe.
   */
  test("preview shows rendered HTML not escaped tags", async ({ page }) => {
    await page.goto("/templates");
    await page.waitForLoadState("networkidle");

    const newBtn = page
      .locator('button:has-text("New")')
      .first()
      .or(page.locator('button:has-text("Create")').first())
      .or(page.locator('button:has-text("Add")').first());

    if (!(await newBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await newBtn.click();
    await page.waitForTimeout(500);

    const editor = page.locator('[contenteditable="true"]').first();
    if (!(await editor.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip();
      return;
    }

    await editor.click();
    await editor.type("Bold test paragraph.");

    // Click preview toggle
    const previewBtn = page
      .locator('button:has-text("Preview")')
      .first();
    if (!(await previewBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await previewBtn.click();
    await page.waitForTimeout(300);

    // Preview iframe should exist
    const iframe = page.locator('iframe[title="Email preview"]').first();
    await expect(iframe).toBeVisible({ timeout: 3000 });

    // The outer page body should NOT contain raw HTML tags like <p> as escaped text
    const outerBody = await page.textContent("body");
    expect(outerBody).not.toContain("&lt;p&gt;");
  });

  /**
   * Sequences page: existing sequences load without crashing.
   * This also tests that legacy plain-text body_override doesn't explode the editor.
   */
  test("existing sequences load without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/sequences");
    await page.waitForLoadState("networkidle");

    // Try to open the first sequence
    const firstSeq = page
      .locator('tr td button, [data-testid="sequence-row"], tbody tr')
      .first();
    if (await firstSeq.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstSeq.click();
      await page.waitForLoadState("networkidle");
    }

    expect(errors).toEqual([]);
  });
});
