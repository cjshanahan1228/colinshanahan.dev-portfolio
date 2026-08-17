import { test, expect } from "@playwright/test";

const modal = "#resumeModal";

// Regression guard for #9. That bug was invisible to static analysis: the
// HTML and JS both parsed fine, but author CSS (display:grid on the backdrop)
// outranked the UA [hidden] rule, so the modal rendered on load and no close
// path had any visible effect. Only a browser can catch that.
test.describe("gated resume modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("stays hidden until asked for", async ({ page }) => {
    await expect(page.locator(modal)).toBeHidden();
  });

  test("every résumé trigger opens it, Escape closes it", async ({ page }) => {
    const triggers = page.locator("[data-resume-request]");
    const count = await triggers.count();
    expect(count, "expected at least one résumé request trigger").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await triggers.nth(i).click();
      await expect(page.locator(modal), `trigger ${i} should open the modal`).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(modal), `Escape should close after trigger ${i}`).toBeHidden();
    }
  });

  test("closes via the X button", async ({ page }) => {
    await page.locator("[data-resume-request]").first().click();
    await expect(page.locator(modal)).toBeVisible();
    await page.locator("#resumeClose").click();
    await expect(page.locator(modal)).toBeHidden();
  });

  test("closes when the backdrop is clicked", async ({ page }) => {
    await page.locator("[data-resume-request]").first().click();
    await expect(page.locator(modal)).toBeVisible();
    await page.locator(modal).click({ position: { x: 6, y: 6 } });
    await expect(page.locator(modal)).toBeHidden();
  });

  test("stays open when the dialog itself is clicked", async ({ page }) => {
    await page.locator("[data-resume-request]").first().click();
    await page.locator("#resumeTitle").click();
    await expect(page.locator(modal)).toBeVisible();
  });

  test("the terminal resume command opens it", async ({ page }) => {
    await page.locator("#term-input").fill("resume");
    await page.locator("#term-input").press("Enter");
    await expect(page.locator(modal)).toBeVisible();
  });

  test("requires a name and a valid email", async ({ page }) => {
    await page.locator("[data-resume-request]").first().click();
    await page.locator("#resumeSubmit").click();
    // Native constraint validation blocks submission — the form stays put.
    await expect(page.locator("#resumeForm")).toBeVisible();
    await expect(page.locator("#resumeDone")).toBeHidden();
  });
});

test.describe("pages render", () => {
  for (const path of ["/", "/architecture", "/case-studies", "/status"]) {
    test(`${path} loads without uncaught errors`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const res = await page.goto(path);
      expect(res?.status(), `${path} should return 200`).toBe(200);
      await expect(page.locator("h1, h2").first()).toBeVisible();
      expect(errors, `${path} threw: ${errors.join("; ")}`).toHaveLength(0);
    });
  }
});
