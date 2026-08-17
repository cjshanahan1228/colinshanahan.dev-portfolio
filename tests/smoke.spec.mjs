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

// Theme is easy to half-ship: a toggle that works but does not persist, or a
// palette that only responds to the OS. Both are checked here.
test.describe("theme", () => {
  const PAGES = ["/", "/architecture", "/case-studies", "/status"];
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  for (const path of PAGES) {
    test(`${path} offers a toggle and honours the OS preference`, async ({ browser }, testInfo) => {
      const dark = await browser.newContext({ colorScheme: "dark" });
      const light = await browser.newContext({ colorScheme: "light" });

      const dp = await dark.newPage();
      await dp.goto(testInfo.project.use.baseURL + path);
      await expect(dp.locator(".theme-toggle")).toBeVisible();
      const darkBg = await bg(dp);

      const lp = await light.newPage();
      await lp.goto(testInfo.project.use.baseURL + path);
      const lightBg = await bg(lp);

      expect(darkBg, `${path} should not paint the same background in both schemes`).not.toBe(lightBg);

      await dark.close();
      await light.close();
    });
  }

  test("an explicit choice overrides the OS and survives reload", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:4173/");

    const osDark = await bg(page);
    await page.locator(".theme-toggle").click();
    const chosenLight = await bg(page);
    expect(chosenLight, "clicking should leave the OS dark background").not.toBe(osDark);

    // The choice must outlive the page, and still beat the dark OS setting.
    await page.reload();
    expect(await bg(page), "choice should persist across reload").toBe(chosenLight);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");

    await ctx.close();
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
