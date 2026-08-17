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

// The whole point of the proof strip is that a recruiter sees it without
// scrolling — so the fold position is the thing worth asserting, not just
// that the markup exists.
test.describe("recruiter skim", () => {
  test("proof points and the résumé CTA sit above the fold on a laptop", async ({ browser }, testInfo) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(testInfo.project.use.baseURL + "/");

    for (const sel of [".proof", ".resume-btn"]) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box, `${sel} should be rendered`).not.toBeNull();
      expect(box.y + box.height, `${sel} should be fully above the 768px fold`).toBeLessThanOrEqual(768);
    }

    // Four figures, each pairing a number with what it means.
    await expect(page.locator(".proof li")).toHaveCount(4);
    await ctx.close();
  });
});

// The status page is the one page whose content comes from a live API, so it
// is stubbed here — the point is that the page renders the payload correctly
// and degrades when fields are missing, not that Azure is reachable from CI.
test.describe("status page", () => {
  const API = "**/api/status";
  const BASE = {
    generatedAt: "2026-08-17T00:00:00Z",
    site: { status: "operational", uptime24h: 100, avgResponseMs: 212, checksLast24h: 288 },
    responseSeries: [{ t: "2026-08-16T00:00:00Z", ms: 200 }, { t: "2026-08-16T01:00:00Z", ms: 220 }],
    deploys: [{ sha: "abc1234", status: "success", branch: "main", when: "2026-08-16T23:00:00Z", url: "#" }],
  };

  test("renders delivery metrics from the API", async ({ page }) => {
    await page.route(API, (r) =>
      r.fulfill({
        json: { ...BASE, delivery: { windowDays: 30, sample: 6, deploysPerWeek: 1.4, changeFailureRate: 0, leadTimeMinutes: 1 } },
      })
    );
    await page.goto("/status");

    const panel = page.locator("section", { hasText: "Delivery" });
    await expect(panel).toContainText("1.4");
    await expect(panel).toContainText("deploys · per week");
    await expect(panel).toContainText("1 min");
    await expect(panel).toContainText("merge → live");
    await expect(panel).toContainText("0%");
    await expect(panel).toContainText("6 runs sampled");
    // Zero failures should read as good, not as an alarm.
    await expect(panel.locator("em.bad")).toHaveCount(0);
  });

  test("shows a non-zero failure rate as a problem, and hours for long lead times", async ({ page }) => {
    await page.route(API, (r) =>
      r.fulfill({
        json: { ...BASE, delivery: { windowDays: 30, sample: 8, deploysPerWeek: 2, changeFailureRate: 12.5, leadTimeMinutes: 195 } },
      })
    );
    await page.goto("/status");

    const panel = page.locator("section", { hasText: "Delivery" });
    await expect(panel).toContainText("12.5%");
    await expect(panel).toContainText("3.3 hr");
    await expect(panel.locator("em.bad")).toHaveCount(1);
  });

  test("degrades when the API omits delivery entirely", async ({ page }) => {
    await page.route(API, (r) => r.fulfill({ json: { ...BASE, delivery: null } }));
    await page.goto("/status");

    await expect(page.locator("section", { hasText: "Delivery" })).toContainText("unavailable");
    // Uptime must still render — the two halves fail independently.
    await expect(page.locator(".hero-status")).toContainText("All systems operational");
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
