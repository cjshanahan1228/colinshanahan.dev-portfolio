// Static checks for the site bundle — no browser, no network, no credentials.
// Run from the repo root: `node .github/scripts/check-site.mjs`
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inlineScriptHashes, scriptSrcOf } from "./csp-hashes.mjs";

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

// Scaffold placeholders that reached production once (issue #15: the hero
// LinkedIn link 404'd for every recruiter who clicked it).
// Uppercase-only on PLACEHOLDER: the lowercase form is a real HTML attribute.
const PLACEHOLDERS = [/YOUR-[A-Z]/, /\bPLACEHOLDER\b/, /\bTODO:/, /lorem ipsum/i];
let placeholders = 0;
for (const page of pages) {
  const html = readFileSync(join(SITE, page), "utf8");
  for (const rx of PLACEHOLDERS) {
    const hit = html.match(rx);
    if (hit) {
      fail(`${page} contains the placeholder "${hit[0]}" — replace it with a real value`);
      placeholders++;
    }
  }
}
if (!placeholders) pass("no scaffold placeholders");

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


// ── Security headers & CSP ────────────────────────────────────────────────
// The CSP allows inline scripts by hash only. If an inline <script> is edited
// without regenerating the hashes the page breaks in production (and only
// there — local previews don't enforce the policy), so fail the PR instead.
{
  const cfg = JSON.parse(readFileSync(join(SITE, "staticwebapp.config.json"), "utf8"));
  const headers = cfg.globalHeaders ?? {};
  const csp = headers["Content-Security-Policy"] ?? "";

  for (const h of [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
  ]) {
    headers[h] ? pass(`globalHeaders sets ${h}`) : fail(`globalHeaders is missing ${h}`);
  }

  /'unsafe-inline'|'unsafe-eval'/.test((csp.match(/(?:^|;)\s*script-src\s+([^;]*)/) ?? [])[1] ?? "")
    ? fail("CSP script-src must not allow 'unsafe-inline' / 'unsafe-eval' (use hashes)")
    : pass("CSP script-src has no unsafe-inline / unsafe-eval");
  for (const d of ["default-src 'none'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) {
    csp.includes(d) ? pass(`CSP has ${d}`) : fail(`CSP is missing ${d}`);
  }

  const have = new Set((scriptSrcOf(readFileSync(join(SITE, "staticwebapp.config.json"), "utf8")) ?? []));
  const missing = inlineScriptHashes(SITE).filter((h) => !have.has(h));
  missing.length
    ? fail(`CSP script-src is missing ${missing.length} inline-script hash(es) — run: node .github/scripts/csp-hashes.mjs --write`)
    : pass("every inline script is covered by a CSP hash");
}

// target="_blank" without rel="noopener" lets the opened page script window.opener.
let unsafeBlank = 0;
for (const page of pages) {
  const html = readFileSync(join(SITE, page), "utf8");
  for (const m of html.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)) {
    if (!/\brel=["'][^"']*\bnoopener\b/i.test(m[0])) {
      fail(`${page}: target="_blank" link without rel="noopener": ${m[0].slice(0, 90)}`);
      unsafeBlank++;
    }
  }
}
if (!unsafeBlank) pass('all target="_blank" links carry rel="noopener"');

console.log(failures ? `\n${failures} check(s) failed` : "\nall site checks passed");
process.exit(failures ? 1 : 0);
