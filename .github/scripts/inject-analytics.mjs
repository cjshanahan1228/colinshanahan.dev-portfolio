// Bake the Application Insights connection string into site/analytics.js at
// deploy time.
//
// The value comes from the repository VARIABLE APPINSIGHTS_CONNECTION_STRING
// (Settings → Secrets and variables → Actions → Variables). It is not a
// secret: the browser SDK needs it, so it ships to every visitor anyway.
// Source: `terraform output -raw appinsights_web_connection_string` in infra/.
//
//   APPINSIGHTS_CONNECTION_STRING=... node .github/scripts/inject-analytics.mjs [siteDir]
//
// Empty / unset → nothing is written, analytics.js keeps "" and the SDK never
// loads (the site deploys exactly as before). A value that is set but wrong
// fails the deploy with a message, instead of shipping silent-broken analytics:
//   - must contain InstrumentationKey=<guid> and IngestionEndpoint=https://….in.applicationinsights.azure.com/
//   - that ingestion origin must be allowed by connect-src in staticwebapp.config.json
//     (otherwise the browser would block every telemetry POST)
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MARKER = /\/\*@APPINSIGHTS_CONNECTION_STRING@\*\/\s*"[^"]*"/;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INGESTION_HOST = /^[a-z0-9-]+\.in\.applicationinsights\.azure\.com$/i;

export function parseConnectionString(raw) {
  const fields = {};
  for (const part of String(raw).split(";")) {
    const i = part.indexOf("=");
    if (i > 0) fields[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  const ikey = fields.instrumentationkey;
  if (!ikey || !GUID.test(ikey)) throw new Error("InstrumentationKey=<guid> is missing or malformed");
  let ingestion;
  try {
    ingestion = new URL(fields.ingestionendpoint);
  } catch {
    throw new Error("IngestionEndpoint=https://<region>.in.applicationinsights.azure.com/ is missing");
  }
  if (ingestion.protocol !== "https:" || !INGESTION_HOST.test(ingestion.hostname)) {
    throw new Error(`IngestionEndpoint ${ingestion.origin} is not an Application Insights ingestion endpoint`);
  }
  // Keep only what the browser SDK uses. LiveEndpoint / ApplicationId are for
  // server SDKs and would only confuse a reader of the shipped file.
  return {
    origin: ingestion.origin,
    value: `InstrumentationKey=${ikey};IngestionEndpoint=${ingestion.origin}/`,
  };
}

// CSP source-expression match, for the host forms this config uses:
// exact origin, or https://*.example.com (wildcard covers subdomains only).
export function connectSrcAllows(csp, origin) {
  const m = csp.match(/(?:^|;)\s*connect-src\s+([^;]*)/);
  if (!m) return false;
  const { protocol, hostname } = new URL(origin);
  return m[1].trim().split(/\s+/).some((src) => {
    if (!src.startsWith(`${protocol}//`)) return false;
    const host = src.slice(protocol.length + 2).replace(/\/.*$/, "").toLowerCase();
    if (host.startsWith("*.")) return hostname.toLowerCase().endsWith(host.slice(1));
    return host === hostname.toLowerCase();
  });
}

export function inject(source, value) {
  if (!MARKER.test(source)) throw new Error("connection-string marker not found in analytics.js");
  return source.replace(MARKER, () => JSON.stringify(value));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  const site = resolve(process.argv[2] || "site");
  const raw = (process.env.APPINSIGHTS_CONNECTION_STRING || "").trim();
  if (!raw) {
    console.log("::notice::APPINSIGHTS_CONNECTION_STRING is not set; deploying without browser analytics");
    process.exit(0);
  }
  try {
    const { origin, value } = parseConnectionString(raw);
    const csp = JSON.parse(readFileSync(join(site, "staticwebapp.config.json"), "utf8")).globalHeaders?.[
      "Content-Security-Policy"
    ];
    if (!connectSrcAllows(csp ?? "", origin)) {
      throw new Error(`connect-src in staticwebapp.config.json does not allow ${origin}; add it, or the browser blocks every telemetry request`);
    }
    const file = join(site, "analytics.js");
    writeFileSync(file, inject(readFileSync(file, "utf8"), value));
    console.log(`  ok   analytics.js configured (ingestion: ${origin})`);
  } catch (e) {
    console.error(`::error::APPINSIGHTS_CONNECTION_STRING: ${e.message}`);
    process.exit(1);
  }
}
