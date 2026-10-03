// Static checks for the site bundle — no browser, no network, no credentials.
// Run from the repo root: `node .github/scripts/check-site.mjs [--strict]`
//
// --strict (or CI_REF / GITHUB_REF_NAME === "main") turns the TODO(colin)
// owner-input placeholder scan from a loud warning into a failure. Deploy
// runs it strict, so a placeholder can never ship; PR branches only warn.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
const STRICT =
  process.argv.includes("--strict") ||
  [process.env.CI_REF, process.env.GITHUB_REF_NAME].includes("main");

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

// Owner-input placeholders: `[TODO(colin): <what is needed>]` marks a figure
// only the owner can supply (never guess one). Branches/PRs may carry them —
// they print a loud WARNING list — but main/deploy (strict) must not. Scans
// everything under site/ (what ships), the resume source, and the generated
// DOCX that the deploy uploads as-is.
{
  const TOKEN = "TODO(colin)";
  const TEXT = /\.(html|js|mjs|css|json|txt|md|svg)$/;
  const walk = (dir) =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : TEXT.test(f) ? [p] : [];
    });
  const hits = [];
  for (const file of [...walk(SITE), join("resume", "resume-content.mjs")]) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes(TOKEN)) hits.push({ file, line: i + 1, text: line.trim().slice(0, 140) });
      });
  }
  const docx = join("resume", "Colin-Shanahan-Resume.docx");
  if (existsSync(docx)) {
    try {
      const xml = execFileSync("unzip", ["-p", docx, "word/document.xml"], { maxBuffer: 1 << 26 }).toString();
      if (xml.includes(TOKEN)) hits.push({ file: docx, line: 0, text: "generated DOCX still contains placeholders — rebuild: cd resume && npm run build" });
    } catch {
      console.warn(`  warn could not inspect ${docx} (is \`unzip\` installed?)`);
    }
  }
  if (!hits.length) {
    pass(`no ${TOKEN} placeholders`);
  } else if (STRICT) {
    for (const h of hits) fail(`${h.file}${h.line ? `:${h.line}` : ""} ${TOKEN} placeholder: ${h.text}`);
  } else {
    console.warn(`\n  ⚠⚠⚠ WARNING: ${hits.length} ${TOKEN} placeholder(s) — fill in before merging to main (strict mode fails on these):`);
    for (const h of hits) {
      console.warn(`  WARN ${h.file}${h.line ? `:${h.line}` : ""}  ${h.text}`);
      if (process.env.GITHUB_ACTIONS) console.warn(`::warning file=${h.file}${h.line ? `,line=${h.line}` : ""}::${TOKEN} placeholder must be filled before merge`);
    }
    console.warn("");
  }
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
