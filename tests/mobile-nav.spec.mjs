import { test, expect } from "@playwright/test";

// Regression guard for #56: below 760px index.html hid its inline nav with no
// replacement, and architecture/status never had one, so phones could not
// reach the sub pages. theme.js now injects a menu button + panel on every
// page; these tests drive it in a real browser at phone widths.

const PAGES = ["/", "/case-studies", "/architecture", "/status"];
const SUB_PAGES = [
  ["Case studies", "/case-studies"],
  ["Architecture", "/architecture"],
  ["Status", "/status"],
];

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

async function overflow(page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
}

async function openMenu(page) {
  await page.locator("#navToggle").click();
  await expect(page.locator("#navToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#siteNav")).toBeVisible();
}

for (const width of [390, 320]) {
  test.describe(`mobile menu at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of PAGES) {
      test(`${path}: button is visible and on screen next to the theme toggle`, async ({ page }) => {
        await page.goto(path);
        const btn = page.locator("#navToggle");
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute("aria-controls", "siteNav");
        await expect(btn).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("#siteNav")).toBeHidden();
        expect(await btn.evaluate((el) => el.tagName)).toBe("BUTTON");

        const [b, t] = [await btn.boundingBox(), await page.locator("#themeToggle").boundingBox()];
        for (const box of [b, t]) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        expect(Math.abs(b.y - t.y), "same row as theme toggle").toBeLessThan(6);
        expect(b.x + b.width <= t.x || t.x + t.width <= b.x, "buttons must not overlap").toBe(true);

        const { scroll, inner } = await overflow(page);
        expect(scroll, "closed: no sideways scroll").toBeLessThanOrEqual(inner);
      });

      test(`${path}: opens, lists every page, no overflow, aria-expanded toggles`, async ({ page }) => {
        await page.goto(path);
        const btn = page.locator("#navToggle");
        await openMenu(page);

        const hrefs = await page.locator("#siteNav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
        for (const [, href] of SUB_PAGES) expect(hrefs).toContain(href);
        expect(hrefs).toContain("/");
        expect(hrefs).toEqual(expect.arrayContaining(["/#experience", "/#projects", "/#skills", "/#console", "/#contact"]));

        // Every link is on screen and a reasonable touch target.
        for (const a of await page.locator("#siteNav a").all()) {
          const box = await a.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.height).toBeGreaterThanOrEqual(40);
        }
        const { scroll, inner } = await overflow(page);
        expect(scroll, "open: no sideways scroll").toBeLessThanOrEqual(inner);

        // The current page is marked.
        await expect(page.locator('#siteNav a[aria-current="page"]')).toHaveCount(1);

        await btn.click();
        await expect(btn).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("#siteNav")).toBeHidden();
      });

      test(`${path}: Escape closes and returns focus to the button`, async ({ page }) => {
        await page.goto(path);
        await openMenu(page);
        // Focus moved into the panel on open.
        await expect(page.locator("#siteNav a").first()).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.locator("#navToggle")).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("#siteNav")).toBeHidden();
        await expect(page.locator("#navToggle")).toBeFocused();
      });
    }

    test("keyboard: Enter on the button opens, Tab walks the links, outside click closes", async ({ page }) => {
      await page.goto("/status");
      await page.locator("#navToggle").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#navToggle")).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#siteNav a").first()).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator("#siteNav a").nth(1)).toBeFocused();
      await page.mouse.click(width / 2, 780);
      await expect(page.locator("#navToggle")).toHaveAttribute("aria-expanded", "false");
    });

    test("same-page anchor link closes the menu and scrolls", async ({ page }) => {
      await page.goto("/");
      await openMenu(page);
      await page.locator('#siteNav a[href="/#contact"]').click();
      await expect(page.locator("#siteNav")).toBeHidden();
      await expect(page).toHaveURL(/\/#contact$/);
    });

    test("links navigate: home reaches every sub page, and each sub page reaches the others and home", async ({ page }) => {
      for (const [name, href] of SUB_PAGES) {
        await page.goto("/");
        await openMenu(page);
        await page.locator("#siteNav").getByRole("link", { name, exact: true }).click();
        await page.waitForURL(new RegExp(`${href}$`));
        await expect(page.locator("#navToggle")).toBeVisible();
      }
      for (const from of ["/case-studies", "/architecture", "/status"]) {
        for (const [name, href] of [...SUB_PAGES, ["Home", "/"]]) {
          if (href === from) continue;
          await page.goto(from);
          await openMenu(page);
          await page.locator("#siteNav").getByRole("link", { name, exact: true }).click();
          await page.waitForURL((u) => u.pathname === href);
        }
      }
    });

    // Contrast of every menu link (and the current-page link) against the
    // surface it actually sits on, in both themes.
    for (const theme of ["light", "dark"]) {
      test(`${theme}: panel text has >= 4.5:1 contrast`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
        for (const path of PAGES) {
          await page.goto(path);
          await openMenu(page);
          expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
          const rows = await page.evaluate(() => {
            const out = [];
            const solid = (el) => {
              // Walk up to the first non-transparent background.
              for (let n = el; n; n = n.parentElement) {
                const bg = getComputedStyle(n).backgroundColor;
                if (!/rgba?\(.*,\s*0\)$/.test(bg) && bg !== "transparent") return bg;
              }
              return "rgb(255, 255, 255)";
            };
            for (const a of document.querySelectorAll("#siteNav a")) {
              out.push({ text: a.textContent, fg: getComputedStyle(a).color, bg: solid(a), cur: a.hasAttribute("aria-current") });
            }
            const t = document.getElementById("navToggle");
            // The button sits on the translucent header: composite it over the page.
            const hb = getComputedStyle(document.querySelector("header")).backgroundColor;
            out.push({ text: "toggle icon (open)", fg: getComputedStyle(t).color, bg: solid(t), cur: false, under: getComputedStyle(document.body).backgroundColor, hb });
            return out;
          });
          for (const r of rows) {
            let bg = parse(r.bg);
            if (r.under) {
              const o = parse(r.under);
              bg = { r: bg.r * bg.a + o.r * (1 - bg.a), g: bg.g * bg.a + o.g * (1 - bg.a), b: bg.b * bg.a + o.b * (1 - bg.a), a: 1 };
            }
            expect(bg.a, `${path} ${r.text}: bg must be opaque`).toBe(1);
            const need = r.text.startsWith("toggle") ? 3 : 4.5; // icon = non-text UI, 3:1
            expect(contrast(parse(r.fg), bg), `${theme} ${path} "${r.text}"${r.cur ? " (current)" : ""}`).toBeGreaterThanOrEqual(need);
          }
        }
      });
    }

    test("OS dark preference (no stored choice) themes the panel dark", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/");
      await openMenu(page);
      const bg = parse(await page.locator("#siteNav").evaluate((el) => getComputedStyle(el).backgroundColor));
      expect(luminance(bg)).toBeLessThan(0.05);
    });
  });
}

test.describe("desktop is unchanged", () => {
  for (const width of [1280, 900]) {
    test.use({ viewport: { width, height: 800 } });
    for (const path of PAGES) {
      test(`${path} at ${width}px: no menu button, no overflow`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("#navToggle")).toBeHidden();
        await expect(page.locator("#siteNav")).toBeHidden();
        await expect(page.locator("#themeToggle")).toBeVisible();
        const { scroll, inner } = await overflow(page);
        expect(scroll).toBeLessThanOrEqual(inner);
      });
    }
    for (const path of ["/", "/case-studies"]) {
      test(`${path} at ${width}px: inline nav still shown`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("header.top nav.menu")).toBeVisible();
      });
    }
  }

  test("an open menu closes when the viewport grows past the breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await openMenu(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#siteNav")).toBeHidden();
    await expect(page.locator("#navToggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("header.top nav.menu")).toBeVisible();
  });
});
