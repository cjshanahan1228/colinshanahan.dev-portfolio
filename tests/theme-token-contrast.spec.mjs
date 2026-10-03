import { test, expect } from "@playwright/test";

// Regression guards for #41 — theme token and muted-text contrast. Computed
// colours in a real browser are the only thing that reflects what a visitor
// sees (tokens flip per theme, and the console panes stay dark in both).

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
const ratio = (fg, bg) => contrast(parse(fg), parse(bg));

const THEMES = ["light", "dark"];
const MIN = 4.5;

async function open(page, theme, path = "/") {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  await page.goto(path);
}

// Resolve a theme token to a computed rgb() string (tokens are authored as hex).
const token = (page, name) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${n})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);

// Nearest opaque ancestor background, i.e. the surface the text sits on.
const surfaceOf = (loc) =>
  loc.evaluate((el) => {
    for (let e = el; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (!/rgba\(.*, 0\)$|transparent/.test(bg)) return bg;
    }
    return "rgb(255, 255, 255)";
  });
const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);

test.describe("status colours", () => {
  for (const theme of THEMES) {
    test(`${theme}: --deploy on its surfaces`, async ({ page }) => {
      await open(page, theme);
      const deploy = await token(page, "--deploy");
      for (const surface of ["--paper", "--mist", "--deploy-soft"]) {
        expect(ratio(deploy, await token(page, surface)), `--deploy on ${surface}`).toBeGreaterThanOrEqual(MIN);
      }
      if (theme === "dark") expect(deploy).toBe("rgb(60, 201, 139)"); // dark value intentionally unchanged
    });

    test(`${theme}: --down on its surfaces`, async ({ page }) => {
      await open(page, theme);
      const down = await token(page, "--down");
      for (const surface of ["--down-soft", "--paper", "--mist"]) {
        expect(ratio(down, await token(page, surface)), `--down on ${surface}`).toBeGreaterThanOrEqual(MIN);
      }
    });
  }

  test("status badges and outcome lines render with the passing colours", async ({ page }) => {
    await page.route("**/api/status", (r) => r.abort());
    await open(page, "light", "/case-studies");
    for (const sel of ["nav.menu a[href='/status']", ".outcome", "p.disclaimer i"]) {
      const el = page.locator(sel).first();
      expect(ratio(await colorOf(el), await surfaceOf(el)), sel).toBeGreaterThanOrEqual(MIN);
    }
  });
});

test.describe("muted text on console surfaces", () => {
  const SELECTORS = [
    ".manifest .cmt",
    ".project-code .cmt",
    ".term-bar span",
    ".term-body .hint",
    ".code-head span",
    ".foot-note span",
    "#footStatus",
  ];
  for (const theme of THEMES) {
    test(`${theme}: >= ${MIN}:1 on --console`, async ({ page }) => {
      await open(page, theme);
      for (const sel of SELECTORS) {
        const el = page.locator(sel).first();
        await el.scrollIntoViewIfNeeded();
        const bg = await surfaceOf(el);
        expect(bg, `${sel} should sit on --console`).toBe(await token(page, "--console"));
        expect(ratio(await colorOf(el), bg), sel).toBeGreaterThanOrEqual(MIN);
      }
    });
  }
});

test.describe("form + focus affordances", () => {
  for (const theme of THEMES) {
    test(`${theme}: modal textarea placeholder uses --slate and passes`, async ({ page }) => {
      await open(page, theme);
      await page.locator(".hero-contact .resume-btn").click();
      const ta = page.locator("#rq-note");
      await expect(ta).toBeVisible();
      const ph = await ta.evaluate((el) => getComputedStyle(el, "::placeholder").color);
      expect(ph).toBe(await token(page, "--slate"));
      expect(ratio(ph, await surfaceOf(ta))).toBeGreaterThanOrEqual(MIN);
    });

    test(`${theme}: terminal input shows a visible focus indicator`, async ({ page }) => {
      await open(page, theme);
      const input = page.locator("#term-input");
      await input.scrollIntoViewIfNeeded();
      await input.focus();
      const o = await input.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
      });
      expect(o.style).not.toBe("none");
      expect(o.width).toBeGreaterThanOrEqual(2);
      // Contrast of the ring against the console it is drawn on (WCAG 1.4.11: 3:1).
      expect(ratio(o.color, await token(page, "--console"))).toBeGreaterThanOrEqual(3);
    });

    test(`${theme}: skip link focus ring is distinguishable from its azure fill`, async ({ page }) => {
      await open(page, theme);
      await page.keyboard.press("Tab");
      const skip = page.locator(".skip-link");
      await expect(skip).toBeFocused();
      await page.waitForTimeout(250); // slide-in transition
      const o = await skip.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          style: cs.outlineStyle,
          width: parseFloat(cs.outlineWidth),
          offset: parseFloat(cs.outlineOffset),
          color: cs.outlineColor,
          fill: cs.backgroundColor,
        };
      });
      expect(o.style).not.toBe("none");
      expect(o.width).toBeGreaterThanOrEqual(2);
      expect(o.color, "ring must not be the same colour as the fill").not.toBe(o.fill);
      // Offset leaves a gap, so the ring is read against the page behind it.
      expect(o.offset).toBeGreaterThanOrEqual(2);
      expect(ratio(o.color, await token(page, "--mist"))).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe("card shadows", () => {
  const read = (page) =>
    page.evaluate(() => ({
      pipeline: getComputedStyle(document.querySelector(".pipeline")).boxShadow,
      term: getComputedStyle(document.querySelector(".term")).boxShadow,
    }));
  const alpha = (shadow) => parseFloat(shadow.match(/rgba?\([^)]*\)/)[0].match(/[\d.]+/g)[3] ?? 1);

  test("light shadows are unchanged", async ({ page }) => {
    await open(page, "light");
    const s = await read(page);
    expect(s.pipeline).toBe("rgba(14, 27, 42, 0.05) 0px 1px 2px 0px");
    expect(s.term).toBe("rgba(14, 27, 42, 0.18) 0px 10px 30px 0px");
    await page.locator(".case").first().scrollIntoViewIfNeeded();
    await page.locator(".case").first().hover();
    await page.waitForTimeout(300);
    expect(await page.locator(".case").first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "rgba(14, 27, 42, 0.08) 0px 8px 24px 0px",
    );
  });

  test("dark shadows are strong enough to register on the dark surfaces", async ({ page }) => {
    await open(page, "dark");
    const s = await read(page);
    for (const [name, shadow] of Object.entries(s)) {
      expect(shadow, name).not.toMatch(/rgba\(14, 27, 42/); // not the light-theme navy
      expect(alpha(shadow), name).toBeGreaterThanOrEqual(0.4);
    }
    await page.locator(".case").first().scrollIntoViewIfNeeded();
    await page.locator(".case").first().hover();
    await page.waitForTimeout(300);
    const hover = await page.locator(".case").first().evaluate((el) => getComputedStyle(el).boxShadow);
    expect(alpha(hover)).toBeGreaterThanOrEqual(0.4);
  });
});
