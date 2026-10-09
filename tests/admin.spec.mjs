import { test, expect } from "@playwright/test";

// The admin page renders attacker-controlled text (requester name/note/email)
// and decides requests as the signed-in admin — no token in the page.
const evil = '<img src=x onerror="window.__pwned=1">';
const listing = {
  ok: true,
  counts: { pending: 1, approved: 0, denied: 0 },
  requests: [
    { id: "123e4567-e89b-12d3-a456-426614174000", name: evil, email: "a@example.com", company: evil, note: evil, status: "pending", createdAt: new Date().toISOString(), decidedAt: null },
  ],
};

test.describe("admin page", () => {
  test("escapes requester-controlled fields", async ({ page }) => {
    await page.route("**/api/resume-admin", (r) => r.fulfill({ json: listing }));
    await page.goto("/admin");
    await expect(page.locator(".req")).toHaveCount(1);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    await expect(page.locator(".req img")).toHaveCount(0);
    await expect(page.locator(".req .who")).toContainText("<img");
  });

  test("approve POSTs JSON {id, action} with no token", async ({ page }) => {
    // After a successful decision admin.js calls load() again, which re-renders
    // the list and replaces the visible .msg with a fresh hidden one. Asserting
    // on .msg after the POST therefore raced that re-render. Instead: hold the
    // decision response to check the in-flight feedback deterministically, then
    // serve the decided state on the reload and assert the card reflects it.
    let decided = false;
    let adminFetches = 0;
    await page.route("**/api/resume-admin", (r) => {
      adminFetches++;
      if (!decided) return r.fulfill({ json: listing });
      const [req] = listing.requests;
      return r.fulfill({
        json: {
          ...listing,
          counts: { pending: 0, approved: 1, denied: 0 },
          requests: [{ ...req, status: "approved", decidedAt: new Date().toISOString() }],
        },
      });
    });
    let posted;
    let release;
    const gate = new Promise((res) => (release = res));
    await page.route("**/api/resume-decision", async (r) => {
      posted = { method: r.request().method(), type: r.request().headers()["content-type"], body: r.request().postDataJSON() };
      await gate;
      decided = true;
      return r.fulfill({ status: 200, contentType: "text/html", body: "ok" });
    });
    await page.goto("/admin");
    await expect(page.locator(".req")).toHaveCount(1);
    await page.locator('.act[data-action="approve"]').click();

    // While the decision is in flight: feedback shown, buttons disabled.
    await expect.poll(() => posted).toBeTruthy();
    await expect(page.locator(".req .msg")).toBeVisible();
    await expect(page.locator(".req .msg")).toHaveText("sending links ...");
    await expect(page.locator(".req .act")).toHaveCount(2);
    for (const b of await page.locator(".req .act").all()) await expect(b).toBeDisabled();

    expect(posted.method).toBe("POST");
    expect(posted.type).toContain("application/json");
    expect(posted.body).toEqual({ id: listing.requests[0].id, action: "approve" });
    expect(JSON.stringify(listing)).not.toMatch(/token/);

    // Release the response: the page reloads the list and shows the decision.
    release();
    await expect(page.locator(".req .badge")).toHaveText("approved");
    await expect(page.locator(".req .act")).toHaveCount(0);
    await expect(page.locator(".counts")).toContainText("1 approved");
    expect(adminFetches).toBe(2);
  });

  test("shows the not-admin message on 403", async ({ page }) => {
    await page.route("**/api/resume-admin", (r) => r.fulfill({ status: 403, json: { ok: false } }));
    await page.goto("/admin");
    await expect(page.locator(".err")).toContainText("not as the configured admin");
  });
});
