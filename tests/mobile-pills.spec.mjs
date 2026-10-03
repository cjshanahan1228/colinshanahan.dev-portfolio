import { test, expect } from "@playwright/test";

// Regression guard for #58: the Case Studies "details generalized · …" note was
// a fully-rounded (99px) pill that wrapped mid-phrase on phones, with the check
// stranded top-left. These tests run at phone widths in both themes.

const PAGES = ["/", "/case-studies", "/architecture", "/status"];
const WIDTHS = [390, 320];
const THEMES = ["light", "dark"];

function parse(color) {
  const m = color.match(/[\d.]+/g).map(Number);
  return { r: m[0], g: m[1], b: m[2] };
}
function luminance({ r, g, b }) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test.describe(`${width}px ${theme}`, () => {
      test.use({ viewport: { width, height: 800 } });
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      });

      for (const path of PAGES) {
        test(`${path}: no horizontal overflow, no multi-line fully-rounded pills`, async ({ page }) => {
          await page.goto(path);
          await page.waitForLoadState("networkidle");
          const res = await page.evaluate(() => {
            const pills = [];
            for (const el of document.querySelectorAll("body *")) {
              const cs = getComputedStyle(el);
              if (cs.display === "none") continue;
              const radius = parseFloat(cs.borderTopLeftRadius) || 0;
              const r = el.getBoundingClientRect();
              // "Fully rounded" = radius at least half the box height (capped
              // radius makes it a stadium), i.e. a pill shape.
              if (!r.height || radius < Math.min(r.height, 99) / 2 || radius < 20) continue;
              if (!el.textContent.trim()) continue;
              const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
              const inner =
                r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) -
                2 * parseFloat(cs.borderTopWidth);
              if (inner > lh * 1.6) pills.push(`${el.tagName}.${el.className}: ${Math.round(inner / lh)} lines`);
            }
            return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, pills };
          });
          expect(res.scroll).toBeLessThanOrEqual(res.inner);
          expect(res.pills).toEqual([]);
        });
      }

      test("/case-studies note: rounded rect, icon on first line, wraps between phrases, readable", async ({ page }) => {
        await page.goto("/case-studies");
        const note = page.locator(".disclaimer");
        await expect(note).toBeVisible();
        await expect(note).toHaveText(/details generalized\s*·\s*no confidential information\s*·\s*relative metrics only/);

        const box = await note.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);

        const radius = await note.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
        expect(radius).toBeLessThanOrEqual(16);

        // Icon vertically centred on the first text line, not the whole block.
        const icon = await page.locator(".disclaimer i").boundingBox();
        const first = await page.locator(".disclaimer-text > span").first().boundingBox();
        expect(Math.abs(icon.y + icon.height / 2 - (first.y + first.height / 2))).toBeLessThanOrEqual(3);

        // No phrase is split across lines: every phrase is one line tall.
        const spans = page.locator(".disclaimer-text > span:not(.sep)");
        await expect(spans).toHaveCount(3);
        for (const s of await spans.all()) {
          const [h, lh] = await s.evaluate((el) => [
            el.getBoundingClientRect().height,
            parseFloat(getComputedStyle(el).lineHeight),
          ]);
          expect(h).toBeLessThan(lh * 1.5);
        }

        // Even vertical padding.
        const pad = await note.evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.paddingTop, cs.paddingBottom].map(parseFloat);
        });
        expect(pad[0]).toBe(pad[1]);

        const { fg, bg, iconFg } = await page.evaluate(() => {
          const n = document.querySelector(".disclaimer");
          return {
            fg: getComputedStyle(n).color,
            bg: getComputedStyle(n).backgroundColor,
            iconFg: getComputedStyle(n.querySelector("i")).color,
          };
        });
        expect(contrast(parse(fg), parse(bg))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(parse(iconFg), parse(bg))).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
}

test("/case-studies note stays a single-line pill on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/case-studies");
  const note = page.locator(".disclaimer");
  const [h, radius] = await note.evaluate((el) => [
    el.getBoundingClientRect().height,
    parseFloat(getComputedStyle(el).borderTopLeftRadius),
  ]);
  expect(h).toBeLessThan(40);
  expect(radius).toBeGreaterThanOrEqual(20);
});
