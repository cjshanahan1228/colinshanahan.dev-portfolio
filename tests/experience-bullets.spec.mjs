import { test, expect } from "@playwright/test";

// RDGFilings experience bullets: each leads with a measurable outcome, stays
// one line on desktop, and doesn't break the card on mobile. Figures come only
// from the case studies; anything else is a `[TODO(colin): …]` placeholder
// (check-site.mjs warns on branches and fails on main/deploy).

const PLACEHOLDER = /\[TODO\(colin\): [^\]]+\]/g;
const rdg = (page) => page.locator("article.job", { hasText: "RDGFilings" }).first();

test.describe("RDGFilings bullets", () => {
  test("keeps the role title, sole-owner lead, and never names Bicep", async ({ page }) => {
    await page.goto("/");
    const job = rdg(page);
    await expect(job.locator(".role")).toHaveText("DevOps Engineer, Cloud Infrastructure");
    await expect(job.locator("li").first()).toContainText("Sole DevOps owner of the company's full Azure estate");
    expect((await job.textContent()).toLowerCase()).not.toContain("bicep");
  });

  test("uses figures sourced from the case studies", async ({ page }) => {
    await page.goto("/");
    const text = await rdg(page).locator("ul").innerText();
    expect(text).toContain("~25 pipelines");
    expect(text).toContain("−40%");
    expect(text).toContain("SOC audits");
    expect(text).toContain("no significant downtime");
  });

  test("every placeholder uses the single greppable TODO(colin) format", async ({ page }) => {
    await page.goto("/");
    const text = await rdg(page).locator("ul").innerText();
    // No half-formed variants (TODO:, TBD, XX, bare TODO(colin) outside brackets).
    expect(text).not.toMatch(/\bTBD\b|\bXX+\b|\bTODO:/);
    expect((text.match(/TODO\(colin\)/g) ?? []).length).toBe((text.match(PLACEHOLDER) ?? []).length);
  });

  test("GCP→Azure outcome line no longer says 'pretty seamless migration'", async ({ page }) => {
    await page.goto("/");
    const cards = await page.locator("#work").innerText();
    expect(cards).not.toContain("pretty seamless migration");
    expect(cards).toContain("✓ [TODO(colin): downtime during cutover] · no significant downtime on main sites");
  });

  test("each bullet fits a one-line budget (font-independent)", async ({ page }) => {
    await page.goto("/");
    for (const li of await rdg(page).locator("li").all()) {
      const t = (await li.innerText()).trim();
      expect(t.length, t).toBeLessThanOrEqual(130);
    }
  });

  test("each bullet is one line at 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    // Widths depend on the real face; without it (offline CI) the char budget above is the guard.
    const hasFont = await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans"'));
    test.skip(!hasFont, "IBM Plex Sans not available in this environment");
    for (const li of await rdg(page).locator("li").all()) {
      const lines = await li.evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2;
        return Math.round(el.getBoundingClientRect().height / lh);
      });
      expect(lines, await li.innerText()).toBe(1);
    }
  });

  test("bullets stay inside the card at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const job = rdg(page);
    const box = await job.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const li of await job.locator("li").all()) {
      expect(await li.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
  });
});
