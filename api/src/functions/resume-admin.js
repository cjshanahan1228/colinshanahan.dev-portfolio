const { app } = require("@azure/functions");
const { PARTITION, config, tableClient } = require("../shared/resume-store");

// Lists every resume request for the owner.
//
// Two independent gates, because either alone is insufficient:
//   1. staticwebapp.config.json requires the `authenticated` role on this
//      route — but that only means "signed in with GitHub", i.e. anyone.
//   2. This handler compares the identity Static Web Apps injects against
//      ADMIN_GITHUB_LOGIN. Without it, the route gate would publish every
//      requester's name, email and note to any GitHub account on earth.
//
// The x-ms-client-principal header is injected by the platform after its own
// auth; a client-supplied copy is stripped at the edge, and managed APIs are
// not addressable except through Static Web Apps.

function principal(req) {
  const raw = req.headers.get("x-ms-client-principal");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Exported so the gate itself can be asserted directly. Fails closed on every
// path: no principal, no configured admin, or any mismatch.
function isAdmin(who, adminLogin) {
  if (!adminLogin) return false;
  const login = String(who?.userDetails || "").trim().toLowerCase();
  return login.length > 0 && login === String(adminLogin).trim().toLowerCase();
}

module.exports = { principal, isAdmin };

app.http("resume-admin", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "resume-admin",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return { status: 503, jsonBody: { ok: false, error: "not configured" } };

    // No configured admin means no admin — fail closed.
    if (!cfg.adminLogin) {
      context.warn("resume-admin called but ADMIN_GITHUB_LOGIN is unset");
      return { status: 503, jsonBody: { ok: false, error: "admin not configured" } };
    }

    const who = principal(req);
    if (!isAdmin(who, cfg.adminLogin)) {
      context.warn(`resume-admin denied for "${who?.userDetails || "anonymous"}"`);
      return { status: 403, jsonBody: { ok: false, error: "forbidden" } };
    }

    const table = tableClient(cfg);
    const requests = [];
    for await (const e of table.listEntities({
      queryOptions: { filter: `PartitionKey eq '${PARTITION}'` },
    })) {
      requests.push({
        id: e.rowKey,
        name: e.name,
        email: e.email,
        company: e.company || "",
        note: e.note || "",
        status: e.status,
        createdAt: e.createdAt,
        decidedAt: e.decidedAt || null,
        // Only pending rows need an actionable token; decided ones do not.
        token: e.status === "pending" ? e.token : undefined,
      });
    }

    requests.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const counts = requests.reduce(
      (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
      { pending: 0, approved: 0, denied: 0 }
    );

    return { jsonBody: { ok: true, counts, requests } };
  },
});
