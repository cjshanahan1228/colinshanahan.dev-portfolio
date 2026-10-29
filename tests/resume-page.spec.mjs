import { test, expect } from "@playwright/test";

// /resume is the readable HTML résumé. It must never leak contact details
// (downloads stay behind the approval gate) and its CTA must reach the modal.
test.describe("live résumé page", () => {
  test("renders the résumé sections", async ({ page }) => {
    const res = await page.goto("/resume");
    expect(res.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Colin Shanahan");
    for (const h of ["Summary", "Experience", "Skills", "Certifications", "Education"]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 3, name: "RDGFilings" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "American Electric Power (AEP)" })).toBeVisible();
    await expect(page.getByText("AZ-104 · 2025, renewed 2026")).toBeVisible();
    await expect(page.getByText("AZ-400 · 2025, renewed 2026")).toBeVisible();
  });

  test("shows no email, phone or mailto/tel links", async ({ page }) => {
    await page.goto("/resume");
    const html = await page.content();
    expect(html).not.toMatch(/@gmail\.com|mailto:|tel:|454-1170/i);
  });

  test("Request PDF / Word opens the gated modal on the home page", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("link", { name: "Request PDF / Word" }).first().click();
    await expect(page).toHaveURL(/\/#request-resume$/);
    await expect(page.locator("#resumeModal")).toBeVisible();
  });

  test("home page links to it from the nav, hero and footer", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('nav.menu a[href="/resume"]')).toHaveCount(1);
    await expect(page.locator('.hero a[href="/resume"]')).toHaveText("View résumé");
    await expect(page.locator('footer a[href="/resume"]')).toHaveText("View résumé");
  });
});
