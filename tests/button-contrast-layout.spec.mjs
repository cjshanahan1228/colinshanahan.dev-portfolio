import { test, expect } from "@playwright/test";

// Regression guards for #40 — only computed styles / layout in a real browser
// expose these; the stylesheets parse fine either way.
//
//  1. Text on --azure fills was a hardcoded #fff. Dark --azure is #61A6EA, so
//     it read 2.58:1 (hover, on --azure-deep #8FC4F4: 1.85:1). --on-azure flips.
//  2. architecture.html's bare `svg{min-width:900px}` also matched the
//     theme-toggle icon → the whole page scrolled sideways.
//  3. case-studies' nowrap nav pushed the toggle off-screen at 390px.

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

const THEMES = ["light", "dark"];
const MIN = 4.5;

async function setTheme(page, theme) {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
}

// Computed text colour vs. the element's own (opaque) background, as it
// currently renders — call again after hover/focus to read the state's colours.
const colors = (loc) =>
  loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fg: cs.color, bg: cs.backgroundColor };
  });

const ratioOf = async (loc) => {
  const { fg, bg } = await colors(loc);
  return contrast(parse(fg), parse(bg));
};

test.describe("--on-azure token", () => {
  for (const theme of THEMES) {
    test(`${theme}: on-azure vs azure and azure-deep >= ${MIN}:1`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/");
      const t = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return ["--on-azure", "--azure", "--azure-deep"].map((n) => cs.getPropertyValue(n).trim());
      });
      const [onAzure, azure, deep] = t;
      // getPropertyValue returns the authored hex; normalise via a probe element.
      const rgb = await page.evaluate((vals) => {
        const p = document.createElement("i");
        document.body.appendChild(p);
        const out = vals.map((v) => {
          p.style.color = v;
          return getComputedStyle(p).color;
        });
        p.remove();
        return out;
      }, [onAzure, azure, deep]);
      expect(contrast(parse(rgb[0]), parse(rgb[1]))).toBeGreaterThanOrEqual(MIN);
      expect(contrast(parse(rgb[0]), parse(rgb[2]))).toBeGreaterThanOrEqual(MIN);
    });
  }
});

test.describe("azure-filled controls are readable (rest + hover)", () => {
  for (const theme of THEMES) {
    test(`${theme}: .resume-btn, .btn.primary`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/");
      for (const sel of [".hero-contact .resume-btn", ".contact-row .btn.primary"]) {
        const el = page.locator(sel).first();
        await el.scrollIntoViewIfNeeded();
        expect(await ratioOf(el), `${theme} ${sel} rest`).toBeGreaterThanOrEqual(MIN);
        await el.hover();
        await page.waitForTimeout(250); // background transition
        expect(await ratioOf(el), `${theme} ${sel} hover`).toBeGreaterThanOrEqual(MIN);
        await page.mouse.move(0, 0);
      }
    });

    test(`${theme}: relocation banner text and link`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/");
      // The real banner is removed while SITE.seeking is false; render the same
      // markup the page builds so the stylesheet is what's under test.
      await page.evaluate(() => {
        const d = document.createElement("div");
        d.className = "banner";
        d.innerHTML =
          '<span class="pin">P</span>Relocating to <strong>Charlotte</strong> — actively seeking roles · <a href="#contact">get in touch</a>';
        document.querySelector("header.top").prepend(d);
      });
      const banner = page.locator(".banner").first();
      expect(await ratioOf(banner)).toBeGreaterThanOrEqual(MIN);
      const link = banner.locator("a");
      const bannerBg = (await colors(banner)).bg;
      const linkFg = (await colors(link)).fg;
      expect(contrast(parse(linkFg), parse(bannerBg))).toBeGreaterThanOrEqual(MIN);
    });

    test(`${theme}: skip link`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto("/");
      await page.keyboard.press("Tab");
      const skip = page.locator(".skip-link");
      await expect(skip).toBeFocused();
      expect(await ratioOf(skip)).toBeGreaterThanOrEqual(MIN);
    });

    test(`${theme}: admin approve button`, async ({ page }) => {
      await setTheme(page, theme);
      await page.route("**/api/resume-admin", (r) =>
        r.fulfill({
          json: {
            counts: { pending: 1, approved: 0, denied: 0 },
            requests: [
              { id: "1", name: "Dana", email: "d@example.com", status: "pending", token: "t", createdAt: new Date().toISOString() },
            ],
          },
        }),
      );
      await page.goto("/admin");
      const approve = page.locator(".act.approve");
      await expect(approve).toBeVisible();
      expect(await ratioOf(approve), "rest").toBeGreaterThanOrEqual(MIN);
      await approve.hover();
      await page.waitForTimeout(250);
      expect(await ratioOf(approve), "hover").toBeGreaterThanOrEqual(MIN);
    });
  }
});

// ---------- layout ----------
const overflow = (page) =>
  page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));

async function toggleInViewport(page) {
  const box = await page.locator("#themeToggle").boundingBox();
  const { inner } = await overflow(page);
  expect(box, "theme toggle should render").not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(inner);
}

test.describe("no horizontal overflow, toggle visible", () => {
  for (const [name, size] of [
    ["desktop", { width: 1280, height: 800 }],
    ["mobile 390", { width: 390, height: 844 }],
  ]) {
    test(`/architecture at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/architecture");
      const { scroll, inner } = await overflow(page);
      expect(scroll, "page must not scroll sideways").toBeLessThanOrEqual(inner);
      await toggleInViewport(page);

      // The toggle icon must keep its 16px size (the old bare `svg` rule gave it 900px+).
      const icon = await page.locator("#themeToggle svg").boundingBox();
      expect(icon.width).toBeLessThanOrEqual(20);

      // The diagram itself is unchanged: still >= 900px wide, and on narrow
      // screens it scrolls inside .board rather than the page.
      const diagram = await page.locator(".board svg").boundingBox();
      expect(diagram.width).toBeGreaterThanOrEqual(900);
      const board = await page.locator(".board").evaluate((el) => ({
        overflowX: getComputedStyle(el).overflowX,
        scrollable: el.scrollWidth > el.clientWidth,
      }));
      expect(board.overflowX).toBe("auto");
      if (size.width < 900) expect(board.scrollable).toBe(true);
    });
  }

  for (const width of [390, 320]) {
    test(`/case-studies at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/case-studies");
      const { scroll, inner } = await overflow(page);
      expect(scroll, "page must not scroll sideways").toBeLessThanOrEqual(inner);
      await toggleInViewport(page);
      // Every nav link stays reachable on screen too.
      for (const a of await page.locator("nav.menu a").all()) {
        const b = await a.boundingBox();
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(inner);
      }
    });
  }

  test("/case-studies keeps the full back link at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/case-studies");
    await expect(page.locator('nav.menu a[href="/#work"]')).toHaveText("← back to portfolio");
    await toggleInViewport(page);
  });
});
