// Admin identity helpers. Static Web Apps authenticates the user and injects
// the x-ms-client-principal header; a client-supplied copy is stripped at the edge.

function principal(req) {
  const raw = req.headers.get("x-ms-client-principal");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Fails closed on every path: no principal, no configured admin, wrong
// identity provider, or any mismatch. The provider check matters because the
// `authenticated` role is granted by every enabled provider, and `userDetails`
// means a GitHub login only for GitHub.
function isAdmin(who, adminLogin) {
  if (!adminLogin) return false;
  if (String(who?.identityProvider || "").toLowerCase() !== "github") return false;
  const login = String(who?.userDetails || "").trim().toLowerCase();
  return login.length > 0 && login === String(adminLogin).trim().toLowerCase();
}

module.exports = { principal, isAdmin };
