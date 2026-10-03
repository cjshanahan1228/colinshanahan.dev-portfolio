// Handler-level tests with the Functions host, Table Storage and ACS stubbed:
// no network, no credentials, no data created anywhere.
const test = require("node:test");
const assert = require("node:assert/strict");

const ID = "123e4567-e89b-12d3-a456-426614174000";
const TOKEN = "ab".repeat(32);

// ── stubs ───────────────────────────────────────────────────────────────────
const handlers = {};
const sent = [];
let emailShouldFail = false;
const tableRows = new Map();
let etagSeq = 0;

function stub(name, exports) {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub("@azure/functions", { app: { http: (n, o) => (handlers[n] = o.handler) } });
stub("@azure/communication-email", {
  EmailClient: class {
    async beginSend(msg) {
      return {
        pollUntilDone: async () => {
          if (emailShouldFail) return { status: "Failed" };
          sent.push(msg);
          return { status: "Succeeded" };
        },
      };
    }
  },
});

const fakeTable = {
  async createEntity(e) { tableRows.set(e.rowKey, { ...e, etag: `W/${++etagSeq}` }); },
  async getEntity(_p, id) {
    const r = tableRows.get(id);
    if (!r) throw Object.assign(new Error("nf"), { statusCode: 404 });
    return { ...r };
  },
  async updateEntity(e, _mode, opts = {}) {
    const r = tableRows.get(e.rowKey);
    if (opts.etag && opts.etag !== r.etag) throw Object.assign(new Error("pc"), { statusCode: 412 });
    tableRows.set(e.rowKey, { ...r, ...e, etag: `W/${++etagSeq}` });
  },
  async *listEntities() { for (const r of tableRows.values()) yield r; },
};

Object.assign(process.env, {
  RESUME_STORAGE_ACCOUNT: "stfake",
  RESUME_STORAGE_KEY: Buffer.from("k".repeat(32)).toString("base64"),
  ACS_CONNECTION_STRING: "endpoint=https://x.communication.azure.com/;accesskey=x",
  EMAIL_SENDER: "DoNotReply@example.azurecomm.net",
  OWNER_EMAIL: "owner@example.com",
  SITE_BASE_URL: "https://www.colinshanahan.dev",
  ADMIN_GITHUB_LOGIN: "the-admin",
});
const real = require("../src/shared/resume-store");
stub("../src/shared/resume-store", { ...real });
require.cache[require.resolve("../src/shared/resume-store")].exports = { ...real, tableClient: () => fakeTable };
// resume.js / resume-admin.js resolve the shared module by path
const storePath = require.resolve("../src/shared/resume-store");
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: { ...real, tableClient: () => fakeTable } };

require("../src/functions/resume");
require("../src/functions/resume-admin");

// ── helpers ─────────────────────────────────────────────────────────────────
const ctx = { log() {}, warn() {}, error() {} };
let ipSeq = 0;
function mkReq({ method = "POST", headers = {}, body, query = {} } = {}) {
  const h = new Headers({ "x-forwarded-for": `198.51.100.${++ipSeq % 250}`, ...headers });
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return { method, headers: h, query: new URLSearchParams(query), text: async () => text, json: async () => JSON.parse(text) };
}
const asAdmin = (over = {}) => ({
  "x-ms-client-principal": Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "the-admin", ...over })).toString("base64"),
});
const seed = (over = {}) =>
  tableRows.set(ID, { partitionKey: "request", rowKey: ID, name: "Pat <b>X</b>", email: "pat@example.com", company: "", note: "", token: TOKEN, status: "pending", createdAt: new Date().toISOString(), etag: `W/${++etagSeq}`, ...over });
const reset = () => { tableRows.clear(); sent.length = 0; emailShouldFail = false; };
const JSON_H = { "content-type": "application/json" };

// ── resume-request ──────────────────────────────────────────────────────────
test("request: rejects non-JSON content type (cross-site form POST)", async () => {
  reset();
  const r = await handlers["resume-request"](mkReq({ headers: { "content-type": "text/plain" }, body: '{"name":"a","email":"a@b.co"}' }), ctx);
  assert.equal(r.status, 415);
  assert.equal(tableRows.size, 0);
});

test("request: rejects a foreign Origin", async () => {
  reset();
  const r = await handlers["resume-request"](mkReq({ headers: { ...JSON_H, origin: "https://evil.example", host: "www.colinshanahan.dev" }, body: { name: "a", email: "a@b.co" } }), ctx);
  assert.equal(r.status, 403);
});

test("request: validates input and never stores honeypot hits", async () => {
  reset();
  const call = (body, h = {}) => handlers["resume-request"](mkReq({ headers: { ...JSON_H, ...h }, body }), ctx);
  assert.equal((await call({ name: "", email: "a@b.co" })).status, 400);
  assert.equal((await call({ name: "x", email: "bad" })).status, 400);
  assert.equal((await call("[1]")).status, 400);
  assert.equal((await call("not json")).status, 400);
  assert.equal((await call({ name: "bot", email: "a@b.co", website: "http://spam" })).status, 202);
  assert.equal(tableRows.size, 0);
  assert.equal(sent.length, 0);
});

test("request: stores a sanitised request and emails the owner once", async () => {
  reset();
  const r = await handlers["resume-request"](
    mkReq({ headers: { ...JSON_H, origin: "https://www.colinshanahan.dev" }, body: { name: "Eve\r\nBcc: x@y.z", email: "eve@example.com", company: "<script>x</script>", note: "hi\r\nthere" } }),
    ctx
  );
  assert.equal(r.status, 202);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(tableRows.size, 1);
  const row = [...tableRows.values()][0];
  assert.equal(row.name, "Eve Bcc: x@y.z");
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].content.subject, /[\r\n]/);
  assert.doesNotMatch(sent[0].content.html, /<script>/);
  assert.match(sent[0].content.html, /&lt;script&gt;/);
});

test("request: per-client rate limit answers 429", async () => {
  reset();
  const same = () => mkReq({ headers: { ...JSON_H, "x-forwarded-for": "203.0.113.77" }, body: { name: "n", email: "n@example.com" } });
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await handlers["resume-request"](same(), ctx)).status);
  assert.deepEqual(codes.slice(0, 5), [202, 202, 202, 202, 202]);
  assert.ok(codes.slice(5).every((c) => c === 429), codes.join());
});

test("request: storage/email failure -> 502 with no detail leaked", async () => {
  reset();
  emailShouldFail = true;
  const r = await handlers["resume-request"](mkReq({ headers: JSON_H, body: { name: "n", email: "n@example.com" } }), ctx);
  assert.equal(r.status, 502);
  assert.deepEqual(Object.keys(r.jsonBody).sort(), ["error", "ok"]);
});

// ── resume-decision ─────────────────────────────────────────────────────────


test("decision GET is read-only: shows a confirm page, changes nothing, sends nothing", async () => {
  reset(); seed();
  const r = await handlers["resume-decision"](mkReq({ method: "GET", query: { id: ID, token: TOKEN, action: "approve" } }), ctx);
  assert.equal(r.status, 200);
  assert.match(r.body, /<form method="post"/);
  assert.match(r.body, /Pat &lt;b&gt;X&lt;\/b&gt;/); // requester text escaped
  assert.equal(tableRows.get(ID).status, "pending");
  assert.equal(sent.length, 0);
  assert.match(r.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("decision GET: bad id / bad token / unknown id", async () => {
  reset(); seed();
  const get = (q) => handlers["resume-decision"](mkReq({ method: "GET", query: q }), ctx);
  assert.equal((await get({ id: "x' or 1", token: TOKEN, action: "approve" })).status, 400);
  assert.equal((await get({ id: ID, token: "0".repeat(64), action: "approve" })).status, 403);
  assert.equal((await get({ id: ID, token: "short", action: "approve" })).status, 403);
  assert.equal((await get({ id: "223e4567-e89b-12d3-a456-426614174000", token: TOKEN, action: "approve" })).status, 404);
  assert.equal((await get({ id: ID, token: TOKEN, action: "delete" })).status, 400);
});

test("decision GET: expired link", async () => {
  reset(); seed({ createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
  const r = await handlers["resume-decision"](mkReq({ method: "GET", query: { id: ID, token: TOKEN, action: "approve" } }), ctx);
  assert.equal(r.status, 410);
});

const form = (o) => new URLSearchParams(o).toString();
const FORM_H = { "content-type": "application/x-www-form-urlencoded" };

test("decision POST with token approves exactly once even when clicked twice concurrently", async () => {
  reset(); seed();
  const mk = () => mkReq({ headers: FORM_H, body: form({ id: ID, token: TOKEN, action: "approve" }) });
  const [a, b] = await Promise.all([handlers["resume-decision"](mk(), ctx), handlers["resume-decision"](mk(), ctx)]);
  assert.equal(sent.length, 1, "requester must receive exactly one email");
  assert.deepEqual([a.status, b.status].sort(), [200, 200]);
  assert.equal(tableRows.get(ID).status, "approved");
  assert.match(sent[0].content.html, /sig=/);
  assert.match(sent[0].content.html, /spr=https/); // HTTPS-only SAS
  assert.equal(sent[0].recipients.to[0].address, "pat@example.com");
});

test("decision POST deny sends nothing", async () => {
  reset(); seed();
  const r = await handlers["resume-decision"](mkReq({ headers: FORM_H, body: form({ id: ID, token: TOKEN, action: "deny" }) }), ctx);
  assert.equal(r.status, 200);
  assert.equal(tableRows.get(ID).status, "denied");
  assert.equal(sent.length, 0);
});

test("decision POST: wrong/missing token is refused and mutates nothing", async () => {
  reset(); seed();
  const post = (o, h = FORM_H) => handlers["resume-decision"](mkReq({ headers: h, body: form(o) }), ctx);
  assert.equal((await post({ id: ID, token: "f".repeat(64), action: "approve" })).status, 403);
  assert.equal((await post({ id: ID, action: "approve" })).status, 403); // no token, no admin
  assert.equal(tableRows.get(ID).status, "pending");
  assert.equal(sent.length, 0);
});

test("decision POST as admin (JSON, same-origin) works without a token", async () => {
  reset(); seed();
  const r = await handlers["resume-decision"](
    mkReq({ headers: { ...JSON_H, ...asAdmin(), origin: "https://www.colinshanahan.dev" }, body: { id: ID, action: "approve" } }), ctx);
  assert.equal(r.status, 200);
  assert.equal(tableRows.get(ID).status, "approved");
  assert.equal(sent.length, 1);
});

test("decision POST as admin is refused for non-admin, wrong provider, missing/foreign Origin, or non-JSON", async () => {
  reset(); seed();
  const attempt = async (h, body = { id: ID, action: "approve" }, ct = JSON_H) =>
    (await handlers["resume-decision"](mkReq({ headers: { ...ct, ...h }, body: ct === JSON_H ? body : form(body) }), ctx)).status;
  const origin = { origin: "https://www.colinshanahan.dev" };
  assert.equal(await attempt({ ...asAdmin({ userDetails: "other" }), ...origin }), 403);
  assert.equal(await attempt({ ...asAdmin({ identityProvider: "aad" }), ...origin }), 403);
  assert.equal(await attempt({ ...asAdmin() }), 403); // no Origin
  assert.equal(await attempt({ ...asAdmin(), origin: "https://evil.example", host: "www.colinshanahan.dev" }), 403);
  assert.equal(await attempt({ ...asAdmin(), ...origin }, { id: ID, action: "approve" }, FORM_H), 403); // form-encoded CSRF shape
  assert.equal(tableRows.get(ID).status, "pending");
  assert.equal(sent.length, 0);
});

test("decision POST: email failure releases the claim so it can be retried", async () => {
  reset(); seed(); emailShouldFail = true;
  const r = await handlers["resume-decision"](mkReq({ headers: FORM_H, body: form({ id: ID, token: TOKEN, action: "approve" }) }), ctx);
  assert.equal(r.status, 502);
  assert.equal(tableRows.get(ID).status, "pending");
});

test("decision POST: abandoned 'approving' claim is retried after the claim TTL", async () => {
  reset(); seed({ status: "approving", claimedAt: new Date(Date.now() - 3_600_000).toISOString() });
  const r = await handlers["resume-decision"](mkReq({ headers: FORM_H, body: form({ id: ID, token: TOKEN, action: "approve" }) }), ctx);
  assert.equal(r.status, 200);
  assert.equal(tableRows.get(ID).status, "approved");
});

// ── resume-admin ────────────────────────────────────────────────────────────
test("admin list: 403 for anonymous / wrong user / wrong provider; no tokens in the payload", async () => {
  reset(); seed();
  const get = (h) => handlers["resume-admin"](mkReq({ method: "GET", headers: h }), ctx);
  assert.equal((await get({})).status, 403);
  assert.equal((await get(asAdmin({ userDetails: "other" }))).status, 403);
  assert.equal((await get(asAdmin({ identityProvider: "aad" }))).status, 403);
  const ok = await get(asAdmin());
  assert.equal(ok.status, 200);
  assert.equal(ok.jsonBody.requests.length, 1);
  assert.ok(!JSON.stringify(ok.jsonBody).includes(TOKEN), "approval token must not be returned");
  assert.equal(ok.headers["Cache-Control"], "no-store");
});
