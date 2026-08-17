// Minimal static server for the smoke tests — mirrors the Static Web Apps
// route rewrites (extensionless paths, navigation fallback) so the tests hit
// the same URLs visitors do. Dependency-free on purpose: nothing to install.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../site", import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  if (rel.endsWith("/")) rel += "index.html";
  if (!extname(rel)) rel += ".html"; // /architecture -> /architecture.html

  const file = resolve(join(ROOT, normalize(rel)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    // navigationFallback: unknown routes serve the SPA shell, as SWA does.
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(join(ROOT, "index.html")).catch(() => "not found"));
  }
}).listen(PORT, "127.0.0.1");
