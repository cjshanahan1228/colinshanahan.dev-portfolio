const crypto = require("node:crypto");
const { app } = require("@azure/functions");
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const {
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} = require("@azure/storage-blob");
const { EmailClient } = require("@azure/communication-email");

// Gated resume flow (request -> owner approval -> expiring signed link):
//   POST /api/resume-request   visitor asks; request lands in Table Storage,
//                              owner gets an email with approve/deny links
//   GET  /api/resume-decision  owner clicks; approve issues 7-day read-only
//                              SAS URLs and emails them to the requester
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
const PARTITION = "request";

// All of these are Terraform-managed SWA app settings. Missing settings mean
// infra hasn't been applied yet — endpoints answer 503 and the site's form
// falls back to a mailto link, so a half-deployed state degrades politely.
function config() {
  const { RESUME_STORAGE_ACCOUNT, RESUME_STORAGE_KEY, ACS_CONNECTION_STRING, EMAIL_SENDER, OWNER_EMAIL } = process.env;
  if (!RESUME_STORAGE_ACCOUNT || !RESUME_STORAGE_KEY || !ACS_CONNECTION_STRING || !EMAIL_SENDER || !OWNER_EMAIL) {
    return null;
  }
  return {
    account: RESUME_STORAGE_ACCOUNT,
    key: RESUME_STORAGE_KEY,
    table: process.env.RESUME_TABLE || "resumerequests",
    acs: ACS_CONNECTION_STRING,
    sender: EMAIL_SENDER,
    owner: OWNER_EMAIL,
    baseUrl: (process.env.SITE_BASE_URL || "https://www.colinshanahan.dev").replace(/\/+$/, ""),
  };
}

function tableClient(cfg) {
  return new TableClient(
    `https://${cfg.account}.table.core.windows.net`,
    cfg.table,
    new AzureNamedKeyCredential(cfg.account, cfg.key)
  );
}

async function sendEmail(cfg, to, subject, html, plainText) {
  const poller = await new EmailClient(cfg.acs).beginSend({
    senderAddress: cfg.sender,
    recipients: { to: [{ address: to }] },
    content: { subject, html, plainText },
  });
  const result = await poller.pollUntilDone();
  if (result.status !== "Succeeded") throw new Error(`email send ${result.status}`);
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Constant-time token check; sha256 first so lengths always match.
function tokenMatches(expected, given) {
  const h = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(h(expected), h(given));
}

// Owner-facing result page for decision clicks. Matches the site palette.
function htmlPage(title, detail, status = 200) {
  return {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="font-family:ui-monospace,monospace;background:#EEF2F6;color:#0E1B2A;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border:1px solid #D5DEE8;border-radius:10px;padding:36px 42px;max-width:34rem">
<h1 style="font-size:1.1rem;margin:0 0 10px">${esc(title)}</h1>
<p style="margin:0;color:#52647A;line-height:1.6">${detail}</p>
<p style="margin:18px 0 0"><a href="https://colinshanahan.dev" style="color:#1B6DC1">colinshanahan.dev</a></p>
</div></body></html>`,
  };
}

// Best-effort abuse damper, per instance (resets on cold start). The real
// cost to a spammer is needing a working inbox to receive anything.
let windowStart = 0;
let windowCount = 0;
const WINDOW_MS = 10 * 60_000;
const WINDOW_MAX = 8;

app.http("resume-request", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "resume-request",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return { status: 503, jsonBody: { ok: false, error: "not configured" } };

    let body;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { ok: false, error: "invalid JSON" } };
    }

    // Honeypot: the form's hidden "website" field. Bots fill it; humans can't
    // see it. Pretend success so the bot moves on.
    if (body.website) return { status: 202, jsonBody: { ok: true } };

    const name = String(body.name ?? "").trim().slice(0, 120);
    const email = String(body.email ?? "").trim().slice(0, 254);
    const company = String(body.company ?? "").trim().slice(0, 120);
    const note = String(body.note ?? "").trim().slice(0, 1000);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { status: 400, jsonBody: { ok: false, error: "name and a valid email are required" } };
    }

    const now = Date.now();
    if (now - windowStart > WINDOW_MS) { windowStart = now; windowCount = 0; }
    if (++windowCount > WINDOW_MAX) {
      return { status: 429, jsonBody: { ok: false, error: "too many requests — try again later" } };
    }

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
<a href="${decide("approve")}" style="background:#1B6DC1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Approve — email them a ${LINK_TTL_DAYS}-day link</a>
&nbsp;&nbsp;<a href="${decide("deny")}" style="color:#52647A">Deny</a></p>`,
      `Resume request: ${name} <${email}>${company ? ` (${company})` : ""}${note ? `\n\n${note}` : ""}\n\nApprove: ${decide("approve")}\nDeny: ${decide("deny")}`
    );

    context.log(`resume request ${id} stored and owner notified`);
    return { status: 202, jsonBody: { ok: true } };
  },
});

app.http("resume-decision", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "resume-decision",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return htmlPage("Not configured", "Infra has not been applied yet.", 503);

    const id = req.query.get("id") ?? "";
    const token = req.query.get("token") ?? "";
    const action = req.query.get("action") ?? "";
    if (!id || !token || !["approve", "deny"].includes(action)) {
      return htmlPage("Bad request", "Missing or malformed parameters.", 400);
    }

    const table = tableClient(cfg);
    let entity;
    try {
      entity = await table.getEntity(PARTITION, id);
    } catch {
      return htmlPage("Not found", "No such request — it may have been created before the last reset.", 404);
    }
    if (!tokenMatches(entity.token, token)) {
      return htmlPage("Forbidden", "Decision link is not valid for this request.", 403);
    }
    if (entity.status !== "pending") {
      return htmlPage(
        `Already ${entity.status}`,
        `This request was decided on ${esc(entity.decidedAt || "an earlier date")}. Nothing was re-sent.`
      );
    }

    if (action === "deny") {
      await table.updateEntity(
        { partitionKey: PARTITION, rowKey: id, status: "denied", decidedAt: new Date().toISOString() },
        "Merge"
      );
      context.log(`resume request ${id} denied`);
      return htmlPage("Denied", `No email was sent to ${esc(entity.email)}. Reply personally if you change your mind.`);
    }

    // Approve: mint read-only SAS links and email them to the requester.
    const cred = new StorageSharedKeyCredential(cfg.account, cfg.key);
    const expiresOn = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000);
    const links = FILES.map((f) => {
      const sas = generateBlobSASQueryParameters(
        {
          containerName: CONTAINER,
          blobName: f.blob,
          permissions: BlobSASPermissions.parse("r"),
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
<p>If a link expires, just request again at <a href="https://colinshanahan.dev">colinshanahan.dev</a> — or reply to reach me directly at Colin.shanahan1@gmail.com.</p>
<p>— Colin</p>`,
      `Hi ${entity.name},\n\nResume download links (valid until ${expiryDate}):\n\n${links.map((l) => `${l.label}: ${l.url}`).join("\n\n")}\n\n— Colin`
    );

    await table.updateEntity(
      { partitionKey: PARTITION, rowKey: id, status: "approved", decidedAt: new Date().toISOString() },
      "Merge"
    );
    context.log(`resume request ${id} approved, links sent`);
    return htmlPage("Approved", `${LINK_TTL_DAYS}-day download links emailed to <strong>${esc(entity.email)}</strong>.`);
  },
});
