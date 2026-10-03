import { test, expect } from "@playwright/test";

// Regression guard for #38. case-studies.html hardcoded its sticky header's
// background (rgba(238,242,246,.88)) instead of using the shared --header-bg
// token from theme.css, so in dark mode the logo/links (which follow the dark
// tokens) rendered near-white text on a light bar. Only computed styles in a
// real browser expose that: the stylesheet parses fine either way.

// WCAG relative luminance / contrast ratio from "rgb(a)(r, g, b[, a])".
function parse(color) {
  const m = color.match(/[\d.]+/g).map(Number);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
}
function luminance({ r, g, b }) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// Header background composited over the page background it sits on.
async function headerColors(page) {
  return page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const header = document.querySelector("header.top");
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      headerBg: cs(header).backgroundColor,
      pageBg: cs(document.body).backgroundColor,
      brand: cs(document.querySelector(".brand")).color,
      links: [...document.querySelectorAll("nav.menu a")].map((a) => ({
        text: a.textContent.trim(),
        color: cs(a).color,
      })),
      toggleBorder: cs(document.querySelector("#themeToggle")).borderTopColor,
    };
  });
}

function over(top, bottom) {
  const t = parse(top);
  const b = parse(bottom);
  const mix = (x, y) => Math.round(x * t.a + y * (1 - t.a));
  return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 };
}

async function openCaseStudiesFromHome(page) {
  await page.goto("/");
  await page.locator('a[href="/case-studies"]').first().click();
  await page.waitForURL(/\/case-studies/);
  await expect(page.locator("header.top")).toBeVisible();
}


test.describe("case studies header follows the theme (#38)", () => {
  test("dark: header is dark with readable logo and links, reached from the homepage", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await openCaseStudiesFromHome(page);

    const c = await headerColors(page);
    expect(c.theme).toBe("dark");
    const bg = over(c.headerBg, c.pageBg);
    expect(luminance(bg), `header bg ${c.headerBg} should be dark`).toBeLessThan(0.05);

    expect(contrast(parse(c.brand), bg), "logo contrast").toBeGreaterThanOrEqual(4.5);
    for (const l of c.links) {
      expect(contrast(parse(l.color), bg), `"${l.text}" link contrast`).toBeGreaterThanOrEqual(4.5);
    }
    // The toggle's border must read against the bar too, not vanish into it.
    expect(contrast(parse(c.toggleBorder), bg), "toggle border contrast").toBeGreaterThanOrEqual(1.3);
  });

  test("dark via OS preference (no stored choice): header is dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openCaseStudiesFromHome(page);

    const c = await headerColors(page);
    expect(c.theme).toBeNull();
    expect(luminance(over(c.headerBg, c.pageBg))).toBeLessThan(0.05);
  });

  test("header matches the homepage header in dark mode", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto("/");
    const home = (await headerColors(page)).headerBg;
    await openCaseStudiesFromHome(page);
    expect((await headerColors(page)).headerBg).toBe(home);
  });

  test("light: header stays light with readable text", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    await openCaseStudiesFromHome(page);

    const c = await headerColors(page);
    expect(c.theme).toBe("light");
    const bg = over(c.headerBg, c.pageBg);
    expect(luminance(bg), `header bg ${c.headerBg} should be light`).toBeGreaterThan(0.7);
    expect(contrast(parse(c.brand), bg)).toBeGreaterThanOrEqual(4.5);
    for (const l of c.links) {
      // The green "status" link is an accent, held to the large-text/UI bar.
      const min = l.text.startsWith("status") ? 3 : 4.5;
      expect(contrast(parse(l.color), bg), `"${l.text}" link contrast`).toBeGreaterThanOrEqual(min);
    }
  });
});
