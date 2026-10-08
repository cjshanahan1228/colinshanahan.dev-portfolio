import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { inject } from "../.github/scripts/inject-analytics.mjs";

// Browser analytics (site/analytics.js → vendored Application Insights SDK).
//
// The committed analytics.js has an empty connection string, and Playwright
// sets navigator.webdriver, so by default nothing loads in CI, the same way
// the smoke runs against production stay out of the numbers. To exercise the
// real path these tests serve analytics.js with a connection string injected
// by the same function the deploy uses, and (where needed) report
// navigator.webdriver = false. serve.mjs applies the production CSP, so the
// "loads" test also proves the CSP lets the SDK reach its ingestion endpoint.

const INGEST = "https://centralus-0.in.applicationinsights.azure.com";
const CS = `InstrumentationKey=00000000-0000-4000-8000-000000000000;IngestionEndpoint=${INGEST}/`;
const SOURCE = readFileSync(new URL("../site/analytics.js", import.meta.url), "utf8");
const PUBLIC_PAGES = ["/", "/case-studies", "/architecture", "/status", "/privacy"];
const ALLOWED_HOSTS = new Set(["127.0.0.1:4173", new URL(INGEST).host, "fonts.googleapis.com", "fonts.gstatic.com", "github.com"]);

async function configure(page, { human = true, gpc = false, dnt = false } = {}) {
  await page.route("**/analytics.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: inject(SOURCE, CS) })
  );
  await page.addInitScript(
    ({ human, gpc, dnt }) => {
      if (human) Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
      if (gpc) Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true, configurable: true });
      if (dnt) Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1", configurable: true });
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    },
    { human, gpc, dnt }
  );
}

// Fake the ingestion endpoint and keep what the SDK sent.
async function captureIngestion(page) {
  const envelopes = [];
  await page.route(`${INGEST}/**`, (r) => {
    const req = r.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "POST, OPTIONS",
    };
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    const body = req.postData() || "[]";
    const items = body.trim().startsWith("[") ? JSON.parse(body) : body.trim().split("\n").map((l) => JSON.parse(l));
    envelopes.push(...items);
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({ itemsReceived: items.length, itemsAccepted: items.length, errors: [] }),
    });
  });
  return envelopes;
}

function sdkRequests(page) {
  const seen = [];
  page.on("request", (req) => {
    if (/\/vendor\/applicationinsights\/|applicationinsights\.azure\.com|monitor\.azure\.com|visualstudio\.com/.test(req.url())) seen.push(req.url());
  });
  return seen;
}

test.describe("analytics stays off", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}: no SDK, notice or cookies as committed (no connection string, webdriver)`, async ({ page, context }) => {
      const sdk = sdkRequests(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      expect(sdk).toEqual([]);
      await expect(page.locator("#cookieNotice")).toHaveCount(0);
      expect((await context.cookies()).filter((c) => c.name.startsWith("ai_"))).toEqual([]);
    });
  }

  test("configured, but navigator.webdriver is true (Playwright, smoke tests): no SDK", async ({ page }) => {
    await configure(page, { human: false });
    const sdk = sdkRequests(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
    expect(sdk).toEqual([]);
    await expect(page.locator("#cookieNotice")).toHaveCount(0);
  });

  test("/admin never loads analytics, even for a configured human browser", async ({ page }) => {
    await page.route("**/api/resume-admin", (r) => r.fulfill({ json: { ok: true, counts: {}, requests: [] } }));
    await configure(page);
    const scripts = [];
    page.on("request", (req) => {
      if (/analytics\.js|\/vendor\/applicationinsights\//.test(req.url())) scripts.push(req.url());
    });
    await page.goto("/admin");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(scripts).toEqual([]);
    await expect(page.locator("#cookieNotice")).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.Microsoft)).toBe("undefined");
  });

  for (const [name, opts] of [
    ["Global Privacy Control", { gpc: true }],
    ["Do Not Track", { dnt: true }],
  ]) {
    test(`${name} is honoured: no SDK, no cookies, no notice`, async ({ page, context }) => {
      await configure(page, opts);
      const sdk = sdkRequests(page);
      await page.goto("/");
      await page.waitForLoadState("networkidle").catch(() => {});
      expect(sdk).toEqual([]);
      await expect(page.locator("#cookieNotice")).toHaveCount(0);
      expect((await context.cookies()).filter((c) => c.name.startsWith("ai_"))).toEqual([]);
    });
  }

  test("bot user agents are skipped", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    const page = await context.newPage();
    await configure(page);
    const sdk = sdkRequests(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(sdk).toEqual([]);
    await context.close();
  });
});

test.describe("analytics on (configured, human browser)", () => {
  test("loads the self-hosted SDK under the production CSP and sends a scrubbed page view", async ({ page, context }) => {
    await configure(page);
    const envelopes = await captureIngestion(page);
    const hosts = new Set();
    page.on("request", (req) => hosts.add(new URL(req.url()).host));

    await page.goto("/case-studies?utm_source=test&email=someone%40example.com#private");
    await expect.poll(() => page.evaluate(() => !!window.appInsights)).toBe(true);
    await page.evaluate(() => window.appInsights.flush());
    await expect.poll(() => envelopes.some((e) => /\.Pageview$/i.test(e.name))).toBe(true);

    const pv = envelopes.find((e) => /\.Pageview$/i.test(e.name));
    // wire format: the SDK serialises the page view's uri as baseData.url
    expect(pv.data.baseData.url).toBe("http://127.0.0.1:4173/case-studies");
    expect(pv.tags["ai.operation.name"]).toBe("/case-studies");
    expect(JSON.stringify(envelopes)).not.toMatch(/someone|example\.com|utm_source|#private/);
    expect(pv.tags["ai.user.id"]).toBeTruthy();
    expect(pv.tags["ai.session.id"]).toBeTruthy();
    expect(pv.tags["ai.user.authUserId"]).toBeUndefined();

    // unique users / sessions come from these two cookies
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toContain("ai_user");
    expect(names).toContain("ai_session");

    // Only the site, the ingestion endpoint and the page's existing origins:
    // no js.monitor.azure.com config sync, no legacy dc.services endpoint.
    for (const h of hosts) expect(ALLOWED_HOSTS, `unexpected request to ${h}`).toContain(h);
    expect(await page.evaluate(() => window.__csp)).toEqual([]);
  });

  test("the resume form's contents never reach telemetry", async ({ page }) => {
    await configure(page);
    const envelopes = await captureIngestion(page);
    await page.route("**/api/resume-request", (r) => r.fulfill({ status: 202, contentType: "application/json", body: '{"ok":true}' }));
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => !!window.appInsights)).toBe(true);
    await page.locator("[data-resume-request]").first().click();
    await page.fill("#rq-name", "Secret Name");
    await page.fill("#rq-email", "secret@example.org");
    await page.click("#resumeSubmit");
    await expect(page.locator("#resumeDone")).toBeVisible();
    await page.evaluate(() => window.appInsights.flush());
    await expect.poll(() => envelopes.length).toBeGreaterThan(0);
    expect(JSON.stringify(envelopes)).not.toMatch(/Secret Name|secret@example\.org|resume-request/);
    expect(envelopes.some((e) => /RemoteDependency/.test(e.name))).toBe(false);
  });

  test("cookie notice renders, links to the privacy note and stays dismissed", async ({ page }) => {
    await configure(page);
    await captureIngestion(page);
    await page.goto("/");
    const notice = page.locator("#cookieNotice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Azure Application Insights cookies to count anonymous visits");
    await expect(notice.getByRole("link", { name: "Privacy note" })).toHaveAttribute("href", "/privacy");
    const dismiss = notice.getByRole("button", { name: "Dismiss cookie notice" });
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cookie-notice-dismissed"))).toBe("1");

    await page.goto("/architecture");
    await expect.poll(() => page.evaluate(() => !!window.appInsights)).toBe(true);
    await expect(page.locator("#cookieNotice")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"]) {
    test(`cookie notice is readable in ${theme} mode and fits a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await configure(page);
      await captureIngestion(page);
      await page.goto("/");
      const notice = page.locator("#cookieNotice");
      await expect(notice).toBeVisible();
      const box = await notice.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

      // mobile menu still opens with the notice on screen
      await page.locator("#navToggle").click();
      await expect(page.locator("#siteNav")).toBeVisible();
      await page.keyboard.press("Escape");

      const colors = await notice.evaluate((el) => {
        const s = getComputedStyle(el);
        return { fg: s.color, bg: s.backgroundColor };
      });
      expect(contrast(parse(colors.fg), parse(colors.bg))).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("privacy page explains collection, retention and GPC/DNT", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("h1")).toHaveText("Privacy note");
    for (const text of ["ai_user", "ai_session", "30 days", "Global Privacy Control", "Do Not Track", "0.0.0.0"]) {
      await expect(page.locator("main")).toContainText(text);
    }
  });
});

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
function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
