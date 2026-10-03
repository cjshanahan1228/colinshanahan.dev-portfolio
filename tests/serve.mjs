// Minimal static server for the smoke tests — mirrors the Static Web Apps
// route rewrites (extensionless paths, navigation fallback) so the tests hit
// the same URLs visitors do. Dependency-free on purpose: nothing to install.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../site", import.meta.url)));
const PORT = Number(process.env.PORT || 4173);

// Apply the same globalHeaders Static Web Apps would (CSP, nosniff, …) so the
// browser tests run under the real policy and a CSP regression fails here,
// not in production.
const GLOBAL_HEADERS =
  JSON.parse(readFileSync(join(ROOT, "staticwebapp.config.json"), "utf8")).globalHeaders ?? {};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  if (rel.endsWith("/")) rel += "index.html";
  if (!extname(rel)) rel += ".html"; // /architecture -> /architecture.html

  const file = resolve(join(ROOT, normalize(rel)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, GLOBAL_HEADERS).end("forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { ...GLOBAL_HEADERS, "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    // navigationFallback: unknown routes serve the SPA shell, as SWA does.
    res.writeHead(404, { ...GLOBAL_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(join(ROOT, "index.html")).catch(() => "not found"));
  }
}).listen(PORT, "127.0.0.1");
