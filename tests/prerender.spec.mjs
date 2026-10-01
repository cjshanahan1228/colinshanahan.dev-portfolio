// The case studies must be in the served HTML, not just in a script that
// builds them: crawlers, LinkedIn/Slack previews and ATS scrapers don't run JS.
// This runs the real build step (.github/scripts/prerender-case-studies.mjs)
// on a copy of site/ and loads the output with JavaScript disabled.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ORIGIN = "http://prerendered.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css" };

// Decode entities the same way a browser would show them, for text comparison.
const textOf = (html) =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/\s+/g, " ").trim();

let built; // a copy of site/ after the build step
let studies; // the source of truth, loaded straight from case-studies.js

test.beforeAll(() => {
  built = mkdtempSync(join(tmpdir(), "site-prerendered-"));
  cpSync(join(REPO, "site"), built, { recursive: true });
  execFileSync("node", [join(REPO, ".github/scripts/prerender-case-studies.mjs"), built], { stdio: "pipe" });
  const sandbox = { window: {} };
  runInNewContext(readFileSync(join(REPO, "site/case-studies.js"), "utf8"), sandbox);
  studies = sandbox.window.CASE_STUDIES;
});
test.afterAll(() => rmSync(built, { recursive: true, force: true }));

// Serve the built copy from memory under a fake origin, mirroring the SWA rewrite.
async function serveBuilt(page) {
  await page.route(`${ORIGIN}/**`, (route) => {
    let rel = new URL(route.request().url()).pathname;
    if (rel === "/") rel = "/index.html";
    if (!extname(rel)) rel += ".html";
    try {
      route.fulfill({ body: readFileSync(join(built, rel)), contentType: TYPES[extname(rel)] || "application/octet-stream" });
    } catch {
      route.fulfill({ status: 404, body: "not found" });
    }
  });
}

test.describe("no-JS HTML", () => {
  test.use({ javaScriptEnabled: false });

  test("/case-studies has every entry's title, summary and outcome", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    const articles = page.locator("article.study");
    await expect(articles).toHaveCount(studies.length);
    for (const c of studies) {
      const a = page.locator(`article.study#${c.slug}`);
      await expect(a.locator("h2")).toHaveText(textOf(c.title));
      await expect(a).toContainText(textOf(c.problem));
      await expect(a.locator(".outcome")).toHaveText(textOf(c.outcome));
    }
  });

  test("entries with a full writeup show Problem / Diagnosis / The fix / Impact in order; summaries show Problem / Approach", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    for (const c of studies) {
      const labels = await page.locator(`article.study#${c.slug} dt`).allTextContents();
      const want = c.detail ? ["Problem", "Diagnosis", "The fix", "Impact"] : ["Problem", "Approach"];
      const idx = want.map((w) => labels.indexOf(w));
      expect(idx.every((i) => i >= 0), `${c.slug} is missing one of ${want} (has ${labels})`).toBe(true);
      expect([...idx].sort((x, y) => x - y), `${c.slug}: sections out of order`).toEqual(idx);
    }
  });

  test("the Octopus/Jenkins study is a full writeup, not the summary-only shape", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    const a = page.locator("article.study#azure-devops-migration");
    const labels = await a.locator("dt").allTextContents();
    expect(labels).toEqual(expect.arrayContaining(["Context", "Problem", "Diagnosis", "The fix", "Impact", "Lessons"]));
    expect(labels).not.toContain("Approach");
    await expect(a.locator(".wip")).toHaveCount(0);
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator('#caseGrid a.more[href="/case-studies#azure-devops-migration"]')).toHaveText("full writeup →");
  });

  test("the GCP-to-Azure study is a full writeup and no longer names Bicep", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    const a = page.locator("article.study#gcp-to-azure-iac");
    const labels = await a.locator("dt").allTextContents();
    expect(labels).toEqual(expect.arrayContaining(["Context", "Problem", "Diagnosis", "The fix", "Impact", "Lessons"]));
    expect(labels).not.toContain("Approach");
    await expect(a.locator("h2")).toHaveText("Replacing hand-built GCP systems with Terraform on Azure");
    expect((await a.textContent()).toLowerCase()).not.toContain("bicep");
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator('#caseGrid a.more[href="/case-studies#gcp-to-azure-iac"]')).toHaveText("full writeup →");
  });

  test("the optional postscript still renders right after Impact", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    for (const c of studies) {
      const labels = await page.locator(`article.study#${c.slug} dt`).allTextContents();
      if (c.detail?.postscript) expect(labels.indexOf("Postscript")).toBe(labels.indexOf("Impact") + 1);
      else expect(labels).not.toContain("Postscript");
    }
  });

  test("homepage shows an entry card per study, linking to its writeup", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator("#caseGrid article.case")).toHaveCount(studies.length);
    for (const c of studies) {
      const link = page.locator(`#caseGrid h3 a[href="/case-studies#${c.slug}"]`);
      await expect(link).toHaveText(textOf(c.title));
      await expect(page.locator("#caseGrid")).toContainText(textOf(c.problem));
    }
  });
});

test.describe("with JS on", () => {
  test("pre-rendered pages are not rendered a second time", async ({ page }) => {
    await serveBuilt(page);
    await page.goto(`${ORIGIN}/case-studies`);
    await expect(page.locator("article.study")).toHaveCount(studies.length);
    await page.goto(`${ORIGIN}/`);
    await expect(page.locator("#caseGrid article.case")).toHaveCount(studies.length);
  });
});

test("the build step is idempotent and leaves no unfilled markers", () => {
  const before = readFileSync(join(built, "case-studies.html"), "utf8");
  execFileSync("node", [join(REPO, ".github/scripts/prerender-case-studies.mjs"), built], { stdio: "pipe" });
  expect(readFileSync(join(built, "case-studies.html"), "utf8")).toBe(before);
  expect(before).not.toContain("<!--prerender:studies--><!--/prerender:studies-->");
});
