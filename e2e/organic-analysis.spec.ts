import { expect, test } from "@playwright/test";

// The page is entirely driven by the get_organic_analysis RPC, so a change to
// the function's JSON shape would break rendering without failing any unit
// test. This asserts the page still builds real panels from live data.
test.describe("Organic Analysis", () => {
  test("renders findings and panels from Search Console data", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/dashboard/organic-analysis?range=last_90_days", {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });

    await expect(
      page.getByRole("heading", { name: /Search performance/i }),
    ).toBeVisible({ timeout: 60_000 });

    const body = await page.textContent("body");
    expect(body).not.toContain("Application error");
    expect(body).not.toContain("Could not load Search Console analysis");

    // The diagnosis panel is the point of the page — it must resolve to either
    // findings or the explicit "nothing stands out" state, never a blank box.
    const findings = page.locator(".organic-finding");
    const emptyState = page.locator(".empty-state", {
      hasText: "Nothing stands out",
    });
    await expect(findings.first().or(emptyState.first())).toBeVisible({
      timeout: 60_000,
    });

    // Hostname split is the analysis this page exists to provide.
    await expect(
      page.getByRole("heading", { name: /Which property is moving/i }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
