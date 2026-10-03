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
    await page.route("**/api/resume-admin", (r) => r.fulfill({ json: listing }));
    let posted;
    await page.route("**/api/resume-decision", (r) => {
      posted = { method: r.request().method(), type: r.request().headers()["content-type"], body: r.request().postDataJSON() };
      return r.fulfill({ status: 200, contentType: "text/html", body: "ok" });
    });
    await page.goto("/admin");
    await page.locator('.act[data-action="approve"]').click();
    await expect.poll(() => posted).toBeTruthy();
    expect(posted.method).toBe("POST");
    expect(posted.type).toContain("application/json");
    expect(posted.body).toEqual({ id: listing.requests[0].id, action: "approve" });
    expect(JSON.stringify(listing)).not.toMatch(/token/);
    await expect(page.locator(".msg").first()).toBeVisible();
  });

  test("shows the not-admin message on 403", async ({ page }) => {
    await page.route("**/api/resume-admin", (r) => r.fulfill({ status: 403, json: { ok: false } }));
    await page.goto("/admin");
    await expect(page.locator(".err")).toContainText("not as the configured admin");
  });
});
