// Shared plumbing for the gated-resume endpoints. Lives outside
// src/functions/ so the Functions host does not try to register it as one.
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

const PARTITION = "request";

// All Terraform-managed SWA app settings. Missing settings mean infra has not
// been applied yet — callers answer 503 rather than throwing, so a
// half-deployed state degrades politely.
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
    // Absent means the admin endpoint stays shut — fail closed, never open.
    adminLogin: process.env.ADMIN_GITHUB_LOGIN || null,
  };
}

function tableClient(cfg) {
  return new TableClient(
    `https://${cfg.account}.table.core.windows.net`,
    cfg.table,
    new AzureNamedKeyCredential(cfg.account, cfg.key)
  );
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { PARTITION, config, tableClient, esc };
