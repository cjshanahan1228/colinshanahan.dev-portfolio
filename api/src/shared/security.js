// Small, dependency-free security helpers for the resume endpoints. Kept apart
// from the function files so they can be unit-tested without the Functions host.

const SEC_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

// Route/global headers from staticwebapp.config.json are not applied to
// managed-function responses, so every response sets its own.
const jsonHeaders = () => ({ ...SEC_HEADERS });
const htmlHeaders = () => ({
  ...SEC_HEADERS,
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
});

// Control characters (incl. CR/LF) have no business in names, subjects or
// log lines. `multiline` keeps \n (and drops \r) for the free-text note.
function clean(value, max, { multiline = false } = {}) {
  let s = String(value ?? "");
  // eslint-disable-next-line no-control-regex
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]/g : /[\u0000-\u001F\u007F\u2028\u2029]/g, " ");
  if (!multiline) s = s.replace(/\s+/g, " ");
  return s.trim().slice(0, max);
}

// Deliberately conservative: one @, no whitespace/angle brackets/quotes/commas,
// a dotted domain without leading/trailing dot or hyphen.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const isEmail = (s) => typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[0-9a-f]{64}$/i;
const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);
const isToken = (s) => typeof s === "string" && TOKEN_RE.test(s);

// First hop of x-forwarded-for, port stripped. SWA sets this at the edge.
function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for") || req.headers.get("x-azure-clientip") || "";
  const first = xff.split(",")[0].trim();
  if (!first) return "unknown";
  if (first.startsWith("[")) return first.slice(1, first.indexOf("]")); // [v6]:port
  return first.includes(".") ? first.replace(/:\d+$/, "") : first; // v4:port | bare v6
}

// True when the Origin header (if any) names the host the request was served
// on, or the configured site origin. `required` makes a missing Origin a failure
// (used for the cookie-authenticated admin path, where CSRF matters).
function sameOrigin(req, baseUrl, { required = false } = {}) {
  const origin = req.headers.get("origin");
  if (!origin) return !required;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const served = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
    .filter(Boolean)
    .map((h) => h.split(",")[0].trim().toLowerCase());
  let base = "";
  try {
    base = new URL(baseUrl).host.toLowerCase();
  } catch { /* no base configured */ }
  return [...served, base].includes(host.toLowerCase());
}

// Fixed-window limiter with a per-client and a global budget. In-memory, so it
// is per function instance and resets on cold start — a damper, not a wall.
function createLimiter({ windowMs, perClient, global, maxClients = 5000, now = Date.now }) {
  let start = 0;
  let total = 0;
  const clients = new Map();
  return function allow(key) {
    const t = now();
    if (t - start > windowMs) {
      start = t;
      total = 0;
      clients.clear();
    }
    const n = (clients.get(key) || 0) + 1;
    if (!clients.has(key) && clients.size >= maxClients) return false; // memory bound: fail closed
    clients.set(key, n);
    if (n > perClient) return false;
    if (++total > global) return false;
    return true;
  };
}

module.exports = {
  jsonHeaders, htmlHeaders, clean, isEmail, isUuid, isToken, clientIp, sameOrigin, createLimiter,
};
