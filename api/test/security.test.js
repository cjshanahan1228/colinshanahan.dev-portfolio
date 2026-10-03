const test = require("node:test");
const assert = require("node:assert/strict");
const {
  clean, isEmail, isUuid, isToken, clientIp, sameOrigin, createLimiter, htmlHeaders, jsonHeaders,
} = require("../src/shared/security");
const { isAdmin, principal } = require("../src/shared/auth");

const req = (headers = {}) => ({ headers: new Headers(headers) });

test("clean strips control characters and CR/LF header-injection payloads", () => {
  assert.equal(clean("Alice\r\nBcc: evil@example.com", 120), "Alice Bcc: evil@example.com");
  assert.equal(clean("  a\u0000b\u2028c ", 10), "a b c"); // C0, DEL, LS/PS become spaces
  assert.equal(clean("x".repeat(500), 120).length, 120);
  assert.equal(clean(undefined, 5), "");
  assert.equal(clean({ toString: () => "ok" }, 5), "ok");
  assert.equal(clean("line1\r\nline2\u0000x", 100, { multiline: true }), "line1 \nline2 x"); // \n kept, \r dropped to space
});

test("isEmail accepts normal addresses and rejects injection / garbage", () => {
  for (const ok of ["a@b.co", "first.last+tag@sub.example.com", "x_y@ex-ample.org"]) assert.ok(isEmail(ok), ok);
  for (const bad of ["", "a@b", "a b@c.com", "a@b.c", "a@@b.com", "<a>@b.com", "a@b.com\r\nBcc: x@y.com", "a,b@c.com", "a@-b.com", "a@b..com", `${"a".repeat(250)}@b.com`, null, 42]) {
    assert.ok(!isEmail(bad), String(bad));
  }
});

test("id / token validators", () => {
  assert.ok(isUuid("123e4567-e89b-12d3-a456-426614174000"));
  assert.ok(!isUuid("123e4567-e89b-12d3-a456-42661417400") && !isUuid("x' or 1 eq 1"));
  assert.ok(isToken("a".repeat(64)) && !isToken("a".repeat(63)) && !isToken("g".repeat(64)));
});

test("clientIp takes the first forwarded hop and strips ports", () => {
  assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.9:5555, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIp(req({ "x-forwarded-for": "[2001:db8::1]:443" })), "2001:db8::1");
  assert.equal(clientIp(req({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  assert.equal(clientIp(req()), "unknown");
});

test("sameOrigin", () => {
  const base = "https://www.colinshanahan.dev";
  assert.ok(sameOrigin(req(), base)); // no Origin, not required
  assert.ok(!sameOrigin(req(), base, { required: true }));
  assert.ok(sameOrigin(req({ origin: "https://www.colinshanahan.dev" }), base));
  assert.ok(sameOrigin(req({ origin: "https://colinshanahan.dev", "x-forwarded-host": "colinshanahan.dev" }), base));
  assert.ok(!sameOrigin(req({ origin: "https://evil.example", "x-forwarded-host": "www.colinshanahan.dev" }), base));
  assert.ok(!sameOrigin(req({ origin: "null" }), base));
});

test("limiter: per-client and global budgets, window reset, bounded memory", () => {
  let t = 0;
  const allow = createLimiter({ windowMs: 1000, perClient: 2, global: 3, maxClients: 3, now: () => t });
  assert.ok(allow("a") && allow("a") && !allow("a")); // per-client cap
  assert.ok(allow("b")); // global total now 3
  assert.ok(!allow("c")); // global cap
  t = 1500;
  assert.ok(allow("a")); // new window
  const tiny = createLimiter({ windowMs: 1000, perClient: 9, global: 99, maxClients: 2, now: () => t });
  assert.ok(tiny("x") && tiny("y") && !tiny("z")); // map full -> fail closed
});

test("isAdmin fails closed and requires the GitHub provider", () => {
  const gh = { identityProvider: "github", userDetails: "CJShanahan1228" };
  assert.ok(isAdmin(gh, "cjshanahan1228"));
  assert.ok(!isAdmin({ ...gh, identityProvider: "aad" }, "cjshanahan1228"));
  assert.ok(!isAdmin({ userDetails: "cjshanahan1228" }, "cjshanahan1228"));
  assert.ok(!isAdmin(gh, "someone-else"));
  assert.ok(!isAdmin(gh, ""));
  assert.ok(!isAdmin(gh, undefined));
  assert.ok(!isAdmin(null, "cjshanahan1228"));
  assert.ok(!isAdmin({ identityProvider: "github", userDetails: "" }, ""));
});

test("principal decodes the SWA header and tolerates garbage", () => {
  const b64 = Buffer.from(JSON.stringify({ userDetails: "me" })).toString("base64");
  assert.equal(principal(req({ "x-ms-client-principal": b64 })).userDetails, "me");
  assert.equal(principal(req({ "x-ms-client-principal": "!!!" })), null);
  assert.equal(principal(req()), null);
});

test("response headers disable caching/sniffing/framing", () => {
  for (const h of [jsonHeaders(), htmlHeaders()]) {
    assert.equal(h["Cache-Control"], "no-store");
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.equal(h["X-Frame-Options"], "DENY");
    assert.equal(h["Referrer-Policy"], "no-referrer");
  }
  assert.match(htmlHeaders()["Content-Security-Policy"], /default-src 'none'/);
});
