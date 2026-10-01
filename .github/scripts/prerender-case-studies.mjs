// Pre-render case studies into static HTML at build time.
//
// site/case-studies.js stays the source of truth; this script runs it, renders
// it through site/case-studies-render.js (the same markup the browser fallback
// uses), and writes the result between the <!--prerender:…--> markers in
// site/case-studies.html (full writeups) and site/index.html (homepage cards).
// Crawlers, link previews and ATS scrapers then see the content without JS.
//
// Idempotent: the markers survive, so re-running replaces the previous output.
// The workflow runs this before deploy; the committed files keep empty markers.
//
//   node .github/scripts/prerender-case-studies.mjs [siteDir]   (default: site)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const SITE = resolve(process.argv[2] || "site");

// Both files attach to `window`; give them a bare one.
const sandbox = { window: {} };
for (const f of ["case-studies.js", "case-studies-render.js"]) {
  runInNewContext(readFileSync(join(SITE, f), "utf8"), sandbox, { filename: f });
}
const studies = sandbox.window.CASE_STUDIES;
const render = sandbox.window.CaseStudiesRender;
if (!Array.isArray(studies) || !studies.length) throw new Error("case-studies.js defines no CASE_STUDIES");
if (!render) throw new Error("case-studies-render.js did not define CaseStudiesRender");

function inject(file, name, markup) {
  const path = join(SITE, file);
  const html = readFileSync(path, "utf8");
  const rx = new RegExp(`<!--prerender:${name}-->[\\s\\S]*?<!--/prerender:${name}-->`);
  if (!rx.test(html)) throw new Error(`${file}: missing <!--prerender:${name}--> markers`);
  // Function replacer: case-study HTML contains "$" sequences that a string
  // replacement would interpret.
  writeFileSync(
    path,
    html.replace(rx, () => `<!--prerender:${name}-->${markup}\n<!--/prerender:${name}-->`)
  );
  console.log(`  ok   ${file}: ${studies.length} ${name} pre-rendered`);
}

inject("case-studies.html", "studies", render.studies(studies));
inject("index.html", "cards", render.cards(studies));
