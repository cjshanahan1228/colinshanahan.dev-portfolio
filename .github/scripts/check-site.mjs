// Static checks for the site bundle — no browser, no network, no credentials.
// Run from the repo root: `node .github/scripts/check-site.mjs`
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SITE = "site";
const pages = readdirSync(SITE).filter((f) => f.endsWith(".html"));
let failures = 0;

const pass = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => {
  console.error(`  FAIL ${msg}`);
  failures++;
};

// The SWA config drives routing and the managed API runtime — a JSON typo
// here breaks the whole site silently at deploy time.
try {
  JSON.parse(readFileSync(join(SITE, "staticwebapp.config.json"), "utf8"));
  pass("staticwebapp.config.json parses");
} catch (e) {
  fail(`staticwebapp.config.json: ${e.message}`);
}

// One syntax error in an inline block takes down every script on the page.
// Skips <script src=...> (external files) and non-JS types.
for (const page of pages) {
  const html = readFileSync(join(SITE, page), "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g)];
  blocks.forEach((m, i) => {
    try {
      new Function(m[1]);
      pass(`${page} inline script ${i + 1} parses`);
    } catch (e) {
      fail(`${page} inline script ${i + 1}: ${e.message}`);
    }
  });
}

// Resume access is gated (issue #5): the container is private, so a direct
// blob link is now a dead download AND a hole in the approval flow.
let directLinks = 0;
for (const page of pages) {
  if (/stcolinshanahanresume\.blob\.core\.windows\.net/.test(readFileSync(join(SITE, page), "utf8"))) {
    fail(`${page} links the resume blob directly — use the request form, access is gated`);
    directLinks++;
  }
}
if (!directLinks) pass("no direct resume blob links");

console.log(failures ? `\n${failures} check(s) failed` : "\nall site checks passed");
process.exit(failures ? 1 : 0);
