import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #8 on top of e2e/admin-access.spec.ts: nested admin
// paths, look-alike paths, a user with no role at all, and evidence shots.
// Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
const uniqueEmail = () => `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

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
  return email;
}

test.describe("AC1: signed-out admin requests go to sign-in", () => {
  test("a nested /admin path keeps its path and query in next", async ({ page }) => {
    const res = await page.request.get("/admin/tables?x=1", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/signin\?next=%2Fadmin%2Ftables%3Fx%3D1$/);
  });

  test("a look-alike path such as /administrator is not sent to sign-in", async ({ page }) => {
    const res = await page.request.get("/administrator", { maxRedirects: 0 });
    expect(res.status()).not.toBe(307);
    expect(res.headers().location ?? "").not.toMatch(/\/signin/);
  });

  test("the sign-in page shown after the redirect posts next=/admin", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/signin\?next=%2Fadmin$/);
    await expect(page.locator('form input[name="next"]')).toHaveValue("/admin");
  });
});

test.describe("AC2: a signed-in non-admin sees the 403 page", () => {
  test("a user with no role at all gets the 403 page and no admin content", async ({ page }) => {
    await signInWithRoles(page, []);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  });

  test("the 403 page is not indexed and links back to the gala", async ({ page }) => {
    await signInWithRoles(page, ["attendee"]);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await page.getByRole("link", { name: "Back to the gala" }).click();
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
  });
});

test.describe("AC3: an admin who is also a sponsor", () => {
  test("sees their own email on /admin", async ({ page }) => {
    const email = await signInWithRoles(page, ["admin", "sponsor"]);
    await page.goto("/admin");
    await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
    await expect(page.getByRole("heading", { name: /403/ })).toHaveCount(0);
  });
});

// Evidence screenshots for the QA report; off unless QA_SHOTS is set.
test.describe("screenshots", () => {
  test.skip(!process.env.QA_SHOTS, "set QA_SHOTS=<dir> to capture");
  const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ];
  for (const vp of viewports) {
    test(`capture ${vp.name}`, async ({ browser }) => {
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      const shot = async (roles: string[] | null, name: string) => {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        const page = await context.newPage();
        if (roles) await signInWithRoles(page, roles);
        await page.goto("/admin");
        if (roles?.includes("admin")) await expect(page.getByText(/Signed in as/)).toBeVisible();
        else if (roles) await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
        else await expect(page).toHaveURL(/\/signin\?next=%2Fadmin$/);
        await page.screenshot({ path: `${dir}/${name}-${vp.name}.png` });
        await context.close();
      };
      await shot(null, "ac1-signed-out-signin");
      await shot(["sponsor"], "ac2-non-admin-403");
      await shot(["admin", "sponsor"], "ac3-admin-sponsor");
    });
  }
});
