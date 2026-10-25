import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #30: FR-10 reports at /admin/reports. Needs a local Supabase and the
// app started with E2E_AUTH=1. Reads only; creates no gala data.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signInAs(page: Page, role: "admin" | "sponsor") {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role });
  expect(error).toBeNull();
}

test("signed out, /admin/reports goes to sign-in", async ({ page }) => {
  const res = await page.request.get("/admin/reports", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent("/admin/reports")}`);
});

test("a sponsor at /admin/reports gets 403 and no report", async ({ page }) => {
  await signInAs(page, "sponsor");
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outstanding balances" })).toHaveCount(0);
});

test("an admin opens Exports, then views the reports", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin/exports");
  await page.getByRole("link", { name: "View reports" }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
});
