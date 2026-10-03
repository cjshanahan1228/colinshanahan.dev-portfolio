import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Security regression guard. tests/serve.mjs applies the globalHeaders from
// site/staticwebapp.config.json, so every browser test in this repo already
// runs under the production Content-Security-Policy; this file asserts the
// policy itself, that nothing the site does trips it, and that API-derived
// data cannot inject markup.

const CONFIG = JSON.parse(readFileSync(new URL("../site/staticwebapp.config.json", import.meta.url), "utf8"));
const STATUS_API = "https://func-colinshanahan-status.azurewebsites.net/api/status";
const PAGES = ["/", "/status", "/architecture", "/case-studies", "/admin"];

// Track CSP violations from the very first script: both the DOM event and
// Chromium's console report (which also covers blocked stylesheets/fonts).
async function watchCsp(page) {
  const seen = [];
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)
    );
  });
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) seen.push(m.text());
  });
  return {
    seen,
    all: async () => [...seen, ...(await page.evaluate(() => window.__csp ?? []))],
  };
}

const statusPayload = (over = {}) => ({
  generatedAt: new Date().toISOString(),
  site: { status: "operational", uptime24h: 99.9, avgResponseMs: 1000, checksLast24h: 864 },
  responseSeries: [{ t: "2026-01-01T00:00:00Z", ms: 900 }, { t: "2026-01-01T01:00:00Z", ms: 1100 }],
  delivery: { sample: 10, deploysPerWeek: 4, leadTimeMinutes: 7, changeFailureRate: 0, windowDays: 30 },
  deploys: [{ sha: "abc1234", status: "success", branch: "main", when: new Date().toISOString(), url: "https://github.com/x/y/actions/runs/1" }],
  ...over,
});

async function mockStatus(page, body) {
  await page.route(STATUS_API, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    })
  );
}

test.describe("response headers (globalHeaders)", () => {
  for (const path of PAGES) {
    test(`${path} carries the security headers`, async ({ request }) => {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBeTruthy();
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["cross-origin-opener-policy"]).toBe("same-origin");
      expect(h["cross-origin-resource-policy"]).toBe("same-origin");

      const csp = h["content-security-policy"];
      expect(csp, "CSP header missing").toBeTruthy();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
      expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
    });
  }

  test("only GitHub sign-in is routable; other providers 404", () => {
    const blocked = CONFIG.routes.filter((r) => r.statusCode === 404).map((r) => r.route);
    expect(blocked).toContain("/.auth/login/aad");
    expect(blocked).toContain("/.auth/login/twitter");
    // the 404 rules must sit before any catch-all so they actually match
    const first404 = CONFIG.routes.findIndex((r) => r.route === "/.auth/login/aad");
    const catchAll = CONFIG.routes.findIndex((r) => r.route === "/*");
    expect(first404).toBeLessThan(catchAll);
  });

  test("the SPA fallback does not mask missing assets or the API", () => {
    const ex = CONFIG.navigationFallback.exclude.join(" ");
    expect(ex).toContain("/api/*");
    expect(ex).toMatch(/map/);
    expect(ex).toMatch(/txt/);
  });

  test("robots.txt and security.txt are served as text", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toMatch(/Disallow: \/admin/);
    const sec = await request.get("/.well-known/security.txt");
    expect(sec.ok()).toBe(true);
    expect(await sec.text()).toMatch(/^Contact: /m);
  });
});

test.describe("CSP is enforced and the site works under it", () => {
  test("an injected inline script is blocked", async ({ page }) => {
    const csp = await watchCsp(page);
    await page.goto("/");
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__injected = true";
      document.body.appendChild(s);
    });
    expect(await page.evaluate(() => window.__injected)).toBeUndefined();
    expect((await csp.all()).join("\n")).toMatch(/script-src/);
  });

  for (const theme of ["light", "dark"]) {
    for (const path of PAGES) {
      test(`${path} (${theme}) loads with zero CSP violations`, async ({ page }) => {
        await mockStatus(page, statusPayload());
        await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
        const csp = await watchCsp(page);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(errors, "uncaught page errors").toEqual([]);
        // Fonts come from Google, which the sandbox/CI may not reach: network
        // failures are fine, policy violations are not.
        expect(await csp.all()).toEqual([]);
      });
    }

    test(`index (${theme}): modal, terminal and form work under CSP`, async ({ page }) => {
      await mockStatus(page, statusPayload());
      await page.route("**/api/resume-request", (route) =>
        route.fulfill({ status: 202, contentType: "application/json", body: '{"ok":true}' })
      );
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      const csp = await watchCsp(page);
      await page.goto("/");

      // terminal
      const input = page.locator("#term-input");
      for (const cmd of ["help", "whoami", "stack", "status", "nope"]) {
        await input.fill(cmd);
        await input.press("Enter");
      }
      await expect(page.locator("#term-body")).toContainText("live telemetry");
      await expect(page.locator("#term-body")).toContainText("command not found: nope");

      // modal + form submit (fetch to /api/resume-request must satisfy connect-src)
      await page.locator("[data-resume-request]").first().click();
      await expect(page.locator("#resumeModal")).toBeVisible();
      await page.fill("#rq-name", "Test Person");
      await page.fill("#rq-email", "test@example.com");
      await page.click("#resumeSubmit");
      await expect(page.locator("#resumeDone")).toBeVisible();

      expect(await csp.all()).toEqual([]);
    });
  }
});

test.describe("API-derived data cannot inject markup", () => {
  const evil = '<img src=x onerror="window.__pwned=1">';

  test("status page escapes hostile fields and refuses non-GitHub links", async ({ page }) => {
    await mockStatus(
      page,
      statusPayload({
        site: { status: "operational", uptime24h: evil, avgResponseMs: evil, checksLast24h: evil },
        delivery: { sample: evil, deploysPerWeek: evil, leadTimeMinutes: 5, changeFailureRate: evil, windowDays: evil },
        deploys: [{ sha: evil, status: 'success" onmouseover="window.__pwned=1', branch: evil, when: new Date().toISOString(), url: "javascript:window.__pwned=1" }],
      })
    );
    await page.goto("/status");
    await expect(page.locator(".deploy-row")).toHaveCount(1);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await expect(page.locator("#app img")).toHaveCount(0);
    await expect(page.locator(".deploy-row .sha")).toHaveAttribute("href", "#");
    await expect(page.locator(".deploy-row")).toContainText("<img");
  });

  test("terminal escapes typed input and API values", async ({ page }) => {
    await mockStatus(
      page,
      statusPayload({ site: { status: evil, uptime24h: 1, avgResponseMs: 1, checksLast24h: 1 }, deploys: [{ sha: evil, status: evil }] })
    );
    await page.goto("/");
    const input = page.locator("#term-input");
    await input.fill('<img src=x onerror="window.__pwned=1"> &amp;');
    await input.press("Enter");
    await input.fill("status");
    await input.press("Enter");
    await expect(page.locator("#term-body")).toContainText("live telemetry");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await expect(page.locator("#term-body img")).toHaveCount(0);
    // '&' is escaped too: the literal "&amp;" the user typed must survive
    await expect(page.locator("#term-body")).toContainText("&amp;");
  });
});
