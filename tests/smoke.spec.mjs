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

test.describe("accessibility", () => {
  test("skip link is reachable and jumps to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.locator(".skip-link");
    await expect(skip, "the skip link should be the first tab stop").toBeFocused();
    // Off-screen until focused, on-screen once focused (it slides in, so poll).
    await expect
      .poll(async () => (await skip.boundingBox()).y, { message: "skip link should slide into view" })
      .toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("modal traps Tab and returns focus to its opener on close", async ({ page }) => {
    await page.goto("/");
    const opener = page.locator("[data-resume-request]").nth(1);
    await opener.click();
    await expect(page.locator("#rq-name")).toBeFocused();

    // Tab all the way round; focus must never escape the dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() =>
        document.getElementById("resumeModal").contains(document.activeElement)
      );
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }
    // And backwards past the first element.
    await page.locator("#rq-name").focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() => document.getElementById("resumeModal").contains(document.activeElement))
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#resumeModal")).toBeHidden();
    await expect(opener, "closing should hand focus back to the trigger").toBeFocused();
  });

  // Contrast passes today; this stops a future palette edit from regressing it.
  for (const scheme of ["light", "dark"]) {
    test(`text meets WCAG AA contrast in ${scheme}`, async ({ browser }, testInfo) => {
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(testInfo.project.use.baseURL + "/");

      const results = await page.evaluate((selectors) => {
        const lum = (c) => {
          const [r, g, b] = c.map((v) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
        const bgOf = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && !bg.includes("rgba(0, 0, 0, 0)") && bg !== "transparent") return parse(bg);
          }
          return [255, 255, 255];
        };
        return selectors.flatMap((sel) => {
          const el = document.querySelector(sel);
          if (!el) return [];
          const cs = getComputedStyle(el);
          const [hi, lo] = [lum(parse(cs.color)), lum(bgOf(el))].sort((a, b) => b - a);
          const size = parseFloat(cs.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
          return [{ sel, ratio: (hi + 0.05) / (lo + 0.05), min: large ? 3 : 4.5 }];
        });
      }, [".lede", ".stat .l", ".job li", ".case dl", ".sec-label", "nav.menu a", "footer p", ".foot-note a", ".principle p", ".tech-tags span"]);

      expect(results.length, "no sample elements found — selectors are stale").toBeGreaterThan(5);
      const failures = results
        .filter((r) => r.ratio < r.min)
        .map((r) => `${r.sel} ${r.ratio.toFixed(2)}:1 (needs ${r.min})`);
      expect(failures, `low contrast in ${scheme}: ${failures.join(", ")}`).toHaveLength(0);

      await ctx.close();
    });
  }
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
