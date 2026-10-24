import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Needs a local Supabase and the app started with E2E_AUTH=1 (see auth.spec.ts).
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signInWithRoles(page: Page, roles: string[]) {
  const email = uniqueEmail();
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const db = admin();
  const { data: profile } = await db.from("profiles").select("id").eq("email", email).single();
  if (roles.length) {
    const { error } = await db
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: profile!.id, role })));
    expect(error).toBeNull();
  }
}

test("a signed-out request to /admin redirects to sign-in", async ({ page }) => {
  const res = await page.request.get("/admin", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/signin\?next=%2Fadmin$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/signin\?next=%2Fadmin$/);
});

test("a signed-in non-admin gets the 403 page at /admin", async ({ page }) => {
  await signInWithRoles(page, ["sponsor"]);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
});

test("a user with admin and sponsor can open /admin", async ({ page }) => {
  await signInWithRoles(page, ["admin", "sponsor"]);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
});
