const { app } = require("@azure/functions");
const { PARTITION, config, tableClient } = require("../shared/resume-store");
const { principal, isAdmin } = require("../shared/auth");
const { jsonHeaders } = require("../shared/security");

// Lists every resume request for the owner.
//
// Two independent gates, because either alone is insufficient:
//   1. staticwebapp.config.json requires the `authenticated` role on this
//      route — but that only means "signed in with an enabled provider", i.e.
//      anyone with a GitHub account.
//   2. This handler compares the identity Static Web Apps injects against
//      ADMIN_GITHUB_LOGIN (and requires the GitHub provider). Without it, the
//      route gate would publish every requester's name, email and note to any
//      GitHub account on earth.
//
// The x-ms-client-principal header is injected by the platform after its own
// auth; a client-supplied copy is stripped at the edge, and managed APIs are
// not addressable except through Static Web Apps.
//
// Approve/deny from the admin page goes through POST /api/resume-decision as
// the signed-in admin, so the per-request approval token is NOT returned here.

// Re-exported for existing callers/tests; implementation lives in shared/auth.
module.exports = { principal, isAdmin };

const json = (status, jsonBody) => ({ status, headers: jsonHeaders(), jsonBody });

app.http("resume-admin", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "resume-admin",
  handler: async (req, context) => {
    const cfg = config();
    if (!cfg) return json(503, { ok: false, error: "not configured" });

    // No configured admin means no admin — fail closed.
    if (!cfg.adminLogin) {
      context.warn("resume-admin called but ADMIN_GITHUB_LOGIN is unset");
      return json(503, { ok: false, error: "admin not configured" });
    }

    if (!isAdmin(principal(req), cfg.adminLogin)) {
      context.warn("resume-admin denied: signed-in user is not the configured admin");
      return json(403, { ok: false, error: "forbidden" });
    }

    try {
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
        });
      }

      requests.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

      const counts = requests.reduce(
        (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
        { pending: 0, approved: 0, denied: 0 }
      );

      return json(200, { ok: true, counts, requests });
    } catch (err) {
      context.error(`resume-admin failed: ${err?.name || "Error"} ${err?.statusCode || ""}`);
      return json(502, { ok: false, error: "storage unavailable" });
    }
  },
});
