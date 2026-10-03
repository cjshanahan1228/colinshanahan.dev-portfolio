// Admin page logic (external file so the CSP can forbid inline scripts).
// Data comes from /api/resume-admin, which only answers the signed-in admin;
// every value is escaped before it reaches innerHTML.
const app = document.getElementById("app");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function fmtAgo(iso) {
  if (!iso) return "–";
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const h = Math.floor(mins / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

function card(r) {
  const pending = r.status === "pending";
  return `
    <div class="req" data-id="${esc(r.id)}">
      <div class="req-top">
        <span class="who">${esc(r.name)}</span>
        ${r.company ? `<span class="co">${esc(r.company)}</span>` : ""}
        <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
        <span class="when">${fmtAgo(r.createdAt)}${r.decidedAt ? " · decided " + fmtAgo(r.decidedAt) : ""}</span>
      </div>
      <a class="mail" href="mailto:${esc(r.email)}">${esc(r.email)}</a>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
      ${pending ? `
        <div class="actions">
          <button class="act approve" data-action="approve">Approve — send links</button>
          <button class="act" data-action="deny">Deny</button>
        </div>
        <p class="msg" hidden></p>` : ""}
    </div>`;
}

async function decide(btn) {
  const row = btn.closest(".req");
  const msg = row.querySelector(".msg");
  const buttons = row.querySelectorAll(".act");
  buttons.forEach(b => (b.disabled = true));
  msg.hidden = false;
  msg.textContent = btn.dataset.action === "approve" ? "sending links ..." : "closing request ...";

  try {
    // The admin session (cookie) authorises the decision server-side; no
    // per-request token is ever sent to this page.
    const res = await fetch("/api/resume-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.dataset.id, action: btn.dataset.action }),
    });
    if (!res.ok) throw new Error(res.status);
    msg.textContent = btn.dataset.action === "approve" ? "approved — links sent" : "denied";
    load();
  } catch {
    msg.textContent = "that failed — try the link in the notification email";
    buttons.forEach(b => (b.disabled = false));
  }
}

async function load() {
  try {
    const res = await fetch("/api/resume-admin", { headers: { Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      app.innerHTML = `<div class="err">Signed in, but not as the configured admin.
        <a href="/.auth/logout?post_logout_redirect_uri=/admin">Sign out and try again</a>.</div>`;
      return;
    }
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();

    const c = d.counts || {};
    const counts = `<div class="counts">
      <span class="count"><b>${c.pending || 0}</b> pending</span>
      <span class="count"><b>${c.approved || 0}</b> approved</span>
      <span class="count"><b>${c.denied || 0}</b> denied</span>
    </div>`;

    app.innerHTML = counts + (d.requests.length
      ? d.requests.map(card).join("")
      : '<p class="skel">no requests yet</p>');

    app.querySelectorAll(".act").forEach(b =>
      b.addEventListener("click", () => decide(b)));
  } catch {
    app.innerHTML = '<div class="err">Could not load requests. The API may still be provisioning — check that infra has been applied.</div>';
  }
}

load();
