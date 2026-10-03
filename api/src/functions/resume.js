const crypto = require("node:crypto");
const { app } = require("@azure/functions");
const { PARTITION, config, tableClient, esc } = require("../shared/resume-store");
const { principal, isAdmin } = require("../shared/auth");
const {
  jsonHeaders, htmlHeaders, clean, isEmail, isUuid, isToken, clientIp, sameOrigin, createLimiter,
} = require("../shared/security");
const {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} = require("@azure/storage-blob");
const { EmailClient } = require("@azure/communication-email");

// Gated resume flow (request -> owner approval -> expiring signed link):
//   POST /api/resume-request   visitor asks; request lands in Table Storage,
//                              owner gets an email with approve/deny links
//   GET  /api/resume-decision  owner clicks the emailed link; shows WHO is asking
//                              and a confirm button — GET never changes state, so
//                              mail-scanner / link-preview prefetches are harmless
//   POST /api/resume-decision  the confirm button (token) or the /admin page
//                              (signed-in admin); approve issues 7-day read-only
//                              HTTPS-only SAS URLs and emails them to the requester
//
// The approve/deny links are capability URLs — a 64-hex-char token only the
// owner's inbox ever sees. The blob container itself is private; a SAS link
// issued here is the only way to the files.

const CONTAINER = "resume";
const FILES = [
  { blob: "Colin-Shanahan-Resume.pdf", label: "PDF" },
  { blob: "Colin-Shanahan-Resume.docx", label: "Word" },
];
const LINK_TTL_DAYS = 7;
const TOKEN_TTL_DAYS = 14; // emailed approve/deny links stop working after this
const CLAIM_TTL_MS = 10 * 60_000; // an "approving" claim older than this is considered abandoned
const MAX_BODY_BYTES = 8 * 1024;

async function sendEmail(cfg, to, subject, html, plainText) {
  const poller = await new EmailClient(cfg.acs).beginSend({
    senderAddress: cfg.sender,
    recipients: { to: [{ address: to }] },
    content: { subject, html, plainText },
  });
  const result = await poller.pollUntilDone();
  if (result.status !== "Succeeded") throw new Error(`email send ${result.status}`);
}

// Constant-time token check; sha256 first so lengths always match.
function tokenMatches(expected, given) {
  const h = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(h(expected), h(given));
}

const PAGE_STYLE = `body{font-family:ui-monospace,monospace;background:#EEF2F6;color:#0E1B2A;display:grid;place-items:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #D5DEE8;border-radius:10px;padding:36px 42px;max-width:34rem}
h1{font-size:1.1rem;margin:0 0 10px}p{margin:0 0 12px;color:#52647A;line-height:1.6}
a{color:#1B6DC1}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #D5DEE8;background:#fff;cursor:pointer;margin-right:10px}
button.go{background:#1B6DC1;border-color:#1B6DC1;color:#fff}dl{margin:0 0 16px;color:#0E1B2A}dt{color:#52647A;font-size:.8rem}dd{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}`;

// Owner-facing result page. `detail` is trusted HTML: every caller escapes
// whatever user-controlled text it interpolates.
function htmlPage(title, detail, status = 200) {
  return {
    status,
    headers: { ...htmlHeaders(), "X-Robots-Tag": "noindex" },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${PAGE_STYLE}</style></head>
<body><div class="card"><h1>${esc(title)}</h1>${detail}
<p><a href="https://colinshanahan.dev">colinshanahan.dev</a></p></div></body></html>`,
  };
}

const json = (status, jsonBody) => ({ status, headers: jsonHeaders(), jsonBody });

// Best-effort abuse damper, per instance (resets on cold start). The real
// cost to a spammer is needing a working inbox to receive anything.
const allowRequest = createLimiter({ windowMs: 15 * 60_000, perClient: 5, global: 30 });

app.http("resume-request", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "resume-request",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return json(503, { ok: false, error: "not configured" });

    // JSON-only: a cross-site <form> can't send application/json without a CORS
    // preflight (which this API never approves), so it can't spam the form.
    if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) {
      return json(415, { ok: false, error: "content-type must be application/json" });
    }
    if (!sameOrigin(req, cfg.baseUrl)) return json(403, { ok: false, error: "forbidden" });
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
      return json(413, { ok: false, error: "request too large" });
    }

    let body;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: "request too large" });
      body = JSON.parse(text);
    } catch {
      return json(400, { ok: false, error: "invalid JSON" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(400, { ok: false, error: "invalid JSON" });
    }

    // Honeypot: the form's hidden "website" field. Bots fill it; humans can't
    // see it. Pretend success so the bot moves on.
    if (body.website) return json(202, { ok: true });

    const name = clean(body.name, 120);
    const email = clean(body.email, 254);
    const company = clean(body.company, 120);
    const note = clean(body.note, 1000, { multiline: true });
    if (!name || !isEmail(email)) {
      return json(400, { ok: false, error: "name and a valid email are required" });
    }

    if (!allowRequest(clientIp(req))) {
      return json(429, { ok: false, error: "too many requests — try again later" });
    }

    try {
      const now = Date.now();
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(32).toString("hex");
      await tableClient(cfg).createEntity({
        partitionKey: PARTITION,
        rowKey: id,
        name, email, company, note, token,
        status: "pending",
        createdAt: new Date(now).toISOString(),
      });

      const decide = (action) => `${cfg.baseUrl}/api/resume-decision?id=${id}&token=${token}&action=${action}`;
      const line = (k, v) => (v ? `<tr><td style="color:#52647A;padding:2px 14px 2px 0">${k}</td><td>${esc(v)}</td></tr>` : "");
      await sendEmail(
        cfg,
        cfg.owner,
        `Resume request — ${name}${company ? ` · ${company}` : ""}`,
        `<p>New resume request from the site:</p>
<table style="font-family:ui-monospace,monospace;font-size:14px">${line("name", name)}${line("email", email)}${line("company", company)}${line("note", note)}</table>
<p style="margin-top:18px">
<a href="${decide("approve")}" style="background:#1B6DC1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; approve — email them a ${LINK_TTL_DAYS}-day link</a>
&nbsp;&nbsp;<a href="${decide("deny")}" style="color:#52647A">Deny</a></p>
<p style="color:#52647A;font-size:12px">Links open a confirmation page; nothing happens until you press the button. They expire after ${TOKEN_TTL_DAYS} days.</p>`,
        `Resume request: ${name} <${email}>${company ? ` (${company})` : ""}${note ? `\n\n${note}` : ""}\n\nReview & approve: ${decide("approve")}\nDeny: ${decide("deny")}`
      );

      context.log(`resume request ${id} stored and owner notified`);
      return json(202, { ok: true });
    } catch (err) {
      // No request data in the log line: names/emails are PII.
      context.error(`resume-request failed: ${err?.name || "Error"} ${err?.statusCode || ""}`);
      return json(502, { ok: false, error: "temporarily unavailable — please email instead" });
    }
  },
});

// Look up + authorise a decision. Returns { entity } or { page } (an error response).
async function loadForDecision(cfg, table, id, token, adminOk) {
  if (!isUuid(id)) return { page: htmlPage("Bad request", "<p>Missing or malformed parameters.</p>", 400) };
  let entity;
  try {
    entity = await table.getEntity(PARTITION, id);
  } catch {
    return { page: htmlPage("Not found", "<p>No such request — it may have been created before the last reset.</p>", 404) };
  }
  if (!adminOk) {
    if (!isToken(token) || !tokenMatches(entity.token, token)) {
      return { page: htmlPage("Forbidden", "<p>Decision link is not valid for this request.</p>", 403) };
    }
    const age = Date.now() - Date.parse(entity.createdAt || 0);
    if (entity.status === "pending" && !(age < TOKEN_TTL_DAYS * 86_400_000)) {
      return { page: htmlPage("Link expired", `<p>This decision link is older than ${TOKEN_TTL_DAYS} days. Use the admin page instead.</p>`, 410) };
    }
  }
  // A claim left behind by a crashed approve (status "approving") is released
  // after a few minutes so the owner can retry.
  if (entity.status === "approving" && !(Date.now() - Date.parse(entity.claimedAt || 0) < CLAIM_TTL_MS)) {
    entity.status = "pending";
  }
  return { entity };
}

const alreadyDecided = (entity) =>
  htmlPage(
    `Already ${entity.status}`,
    `<p>This request was decided on ${esc(entity.decidedAt || "an earlier date")}. Nothing was re-sent.</p>`
  );

// GET: read-only. Shows who is asking and a confirm form (POST).
app.http("resume-decision", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "resume-decision",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return htmlPage("Not configured", "<p>Infra has not been applied yet.</p>", 503);
    const table = tableClient(cfg);

    try {
      if (req.method === "GET") {
        const id = req.query.get("id") ?? "";
        const token = req.query.get("token") ?? "";
        const action = req.query.get("action") ?? "";
        if (!["approve", "deny"].includes(action)) {
          return htmlPage("Bad request", "<p>Missing or malformed parameters.</p>", 400);
        }
        const loaded = await loadForDecision(cfg, table, id, token, false);
        if (loaded.page) return loaded.page;
        const { entity } = loaded;
        if (entity.status !== "pending") return alreadyDecided(entity);

        const verb = action === "approve" ? "Approve" : "Deny";
        const field = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
        return htmlPage(
          `${verb} this resume request?`,
          `<dl>${field("name", entity.name)}${field("email", entity.email)}${field("company", entity.company)}${field("note", entity.note)}</dl>
<form method="post" action="/api/resume-decision">
<input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="${esc(action)}">
<button class="go" type="submit">${verb}${action === "approve" ? ` — email ${LINK_TTL_DAYS}-day links` : ""}</button>
</form>`
        );
      }

      // ── POST: state change ────────────────────────────────────────────
      const ctype = (req.headers.get("content-type") || "").toLowerCase();
      const isJson = ctype.startsWith("application/json");
      if (!isJson && !ctype.startsWith("application/x-www-form-urlencoded")) {
        return htmlPage("Unsupported", "<p>Unsupported content type.</p>", 415);
      }
      if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
        return htmlPage("Too large", "<p>Request too large.</p>", 413);
      }
      let id, token, action;
      if (isJson) {
        const b = await req.json().catch(() => ({}));
        ({ id = "", token = "", action = "" } = b && typeof b === "object" ? b : {});
      } else {
        const f = new URLSearchParams(await req.text());
        id = f.get("id") ?? "";
        token = f.get("token") ?? "";
        action = f.get("action") ?? "";
      }
      if (!["approve", "deny"].includes(action)) {
        return htmlPage("Bad request", "<p>Missing or malformed parameters.</p>", 400);
      }

      // A signed-in admin (cookie auth) may decide without the emailed token — but
      // that path is cookie-authenticated, so it must be same-origin JSON (CSRF).
      const hasToken = typeof token === "string" && token.length > 0;
      let adminOk = false;
      if (!hasToken) {
        adminOk = !!cfg.adminLogin && isAdmin(principal(req), cfg.adminLogin) &&
          isJson && sameOrigin(req, cfg.baseUrl, { required: true });
        if (!adminOk) return htmlPage("Forbidden", "<p>Decision link is not valid for this request.</p>", 403);
      }

      const loaded = await loadForDecision(cfg, table, id, token, adminOk);
      if (loaded.page) return loaded.page;
      const { entity } = loaded;
      if (entity.status !== "pending") return alreadyDecided(entity);

      // Claim the request with an ETag-conditional write so concurrent clicks
      // can't both proceed (no duplicate emails). Loser gets a 412.
      const claim = async (status, extra = {}) =>
        table.updateEntity({ partitionKey: PARTITION, rowKey: id, status, ...extra }, "Merge", { etag: entity.etag });
      try {
        await claim(action === "deny" ? "denied" : "approving", action === "deny" ? { decidedAt: new Date().toISOString() } : { claimedAt: new Date().toISOString() });
      } catch (err) {
        if (err?.statusCode === 412) return alreadyDecided({ ...entity, status: "decided" });
        throw err;
      }

      if (action === "deny") {
        context.log(`resume request ${id} denied`);
        return htmlPage("Denied", `<p>No email was sent to ${esc(entity.email)}. Reply personally if you change your mind.</p>`);
      }

      // Approve: mint read-only SAS links and email them to the requester.
      try {
        const cred = new StorageSharedKeyCredential(cfg.account, cfg.key);
        const expiresOn = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000);
        const links = FILES.map((f) => {
          const sas = generateBlobSASQueryParameters(
            {
              containerName: CONTAINER,
              blobName: f.blob,
              permissions: BlobSASPermissions.parse("r"),
              protocol: SASProtocol.Https,
              startsOn: new Date(Date.now() - 5 * 60_000), // absorb clock skew
              expiresOn,
            },
            cred
          ).toString();
          return { ...f, url: `https://${cfg.account}.blob.core.windows.net/${CONTAINER}/${f.blob}?${sas}` };
        });

        const expiryDate = expiresOn.toISOString().slice(0, 10);
        await sendEmail(
          cfg,
          entity.email,
          "Colin Shanahan — resume download links",
          `<p>Hi ${esc(entity.name)},</p>
<p>Thanks for your interest — here's my resume. The links below are valid until <strong>${expiryDate}</strong>:</p>
<p>${links.map((l) => `<a href="${l.url}" style="background:#1B6DC1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Download ${l.label}</a>`).join("&nbsp;&nbsp;")}</p>
<p>If a link expires, just request again at <a href="https://colinshanahan.dev">colinshanahan.dev</a> — or reply to reach me directly at ${esc(cfg.owner)}.</p>
<p>— Colin</p>`,
          `Hi ${entity.name},\n\nResume download links (valid until ${expiryDate}):\n\n${links.map((l) => `${l.label}: ${l.url}`).join("\n\n")}\n\n— Colin`
        );
      } catch (err) {
        // Release the claim so the owner can retry.
        await table.updateEntity({ partitionKey: PARTITION, rowKey: id, status: "pending" }, "Merge").catch(() => {});
        context.error(`resume request ${id} approve failed: ${err?.name || "Error"} ${err?.statusCode || ""}`);
        return htmlPage("Could not send", "<p>The email could not be sent. The request is still pending — try again.</p>", 502);
      }

      await table.updateEntity(
        { partitionKey: PARTITION, rowKey: id, status: "approved", decidedAt: new Date().toISOString() },
        "Merge"
      );
      context.log(`resume request ${id} approved, links sent`);
      return htmlPage("Approved", `<p>${LINK_TTL_DAYS}-day download links emailed to <strong>${esc(entity.email)}</strong>.</p>`);
    } catch (err) {
      context.error(`resume-decision failed: ${err?.name || "Error"} ${err?.statusCode || ""}`);
      return htmlPage("Something went wrong", "<p>Unexpected error — check the function logs.</p>", 500);
    }
  },
});
