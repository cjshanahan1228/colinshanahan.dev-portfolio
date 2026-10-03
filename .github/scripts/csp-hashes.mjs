// Keeps the Content-Security-Policy in site/staticwebapp.config.json in sync
// with the inline <script> blocks in site/*.html.
//
// The CSP allows inline scripts only by SHA-256 hash (no 'unsafe-inline'), so
// editing an inline script without updating the policy would silently break
// that page in production. This tool is the single source of the hash list:
//
//   node .github/scripts/csp-hashes.mjs           # check: exit 1 if out of sync
//   node .github/scripts/csp-hashes.mjs --write   # rewrite script-src in the config
//
// check-site.mjs runs the check on every PR.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SITE = process.env.SITE_DIR || "site";
const CONFIG = join(SITE, "staticwebapp.config.json");

// Executable inline blocks only: skips <script src=…> and non-JS types (JSON-LD etc.).
const INLINE = /<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/g;

export function inlineScriptHashes(dir = SITE) {
  const hashes = new Set();
  for (const page of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(dir, page), "utf8");
    for (const m of html.matchAll(INLINE)) {
      if (!m[1].trim()) continue;
      hashes.add(`'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
    }
  }
  return [...hashes].sort();
}

export function scriptSrcOf(configText) {
  const csp = JSON.parse(configText).globalHeaders?.["Content-Security-Policy"] ?? "";
  const m = csp.match(/(?:^|;)\s*script-src\s+([^;]*)/);
  return m ? m[1].trim().split(/\s+/) : null;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const want = inlineScriptHashes();
  const raw = readFileSync(CONFIG, "utf8");
  const have = scriptSrcOf(raw);
  if (!have) {
    console.error("  FAIL no script-src directive in globalHeaders.Content-Security-Policy");
    process.exit(1);
  }
  const haveHashes = have.filter((t) => t.startsWith("'sha256-")).sort();
  const inSync = want.length === haveHashes.length && want.every((h, i) => h === haveHashes[i]);

  if (process.argv.includes("--write")) {
    const next = raw.replace(/(script-src\s+)([^;"]*)/, `$1'self' ${want.join(" ")}`);
    writeFileSync(CONFIG, next);
    console.log(`  wrote ${want.length} script hash(es) to ${CONFIG}`);
  } else if (!inSync) {
    console.error("  FAIL CSP script-src hashes are out of sync with the inline scripts in site/*.html");
    console.error("       run: node .github/scripts/csp-hashes.mjs --write");
    process.exit(1);
  } else {
    console.log(`  ok   CSP script-src hashes match the ${want.length} inline script(s)`);
  }
}
