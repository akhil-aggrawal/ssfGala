import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

// Needs a local Supabase (`supabase start`) and the app started with
// E2E_AUTH=1 plus the NEXT_PUBLIC_SUPABASE_* / SUPABASE_SERVICE_ROLE_KEY env.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const testSignIn = (email: string, next: string) =>
  `/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`;
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

test("after sign-in the user returns to the exact next path, incl. /invite/<token>", async ({ page }) => {
  await page.goto(testSignIn(uniqueEmail(), "/invite/tok123?ref=mail"));
  await expect(page).toHaveURL(/\/invite\/tok123\?ref=mail$/);
});

test("a next on another origin is ignored and the user lands on /", async ({ page }) => {
  await page.goto(testSignIn(uniqueEmail(), "https://evil.example/phish"));
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
});

test("the first sign-in creates one profiles row; a second creates none", async ({ browser }) => {
  const email = uniqueEmail();
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(testSignIn(email, "/"));
    await expect(page.getByRole("navigation", { name: "Main" }).getByText("Account")).toBeVisible();
    await context.close();
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("email", email);
  expect(error).toBeNull();
  expect(count).toBe(1);
});

test("sign-out clears the session and the header shows Sign In again", async ({ page, context }) => {
  await page.goto(testSignIn(uniqueEmail(), "/"));
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByText("Account").click();
  await nav.getByRole("button", { name: "Sign out" }).click();
  await expect(nav.getByRole("link", { name: "Sign In", exact: true })).toBeVisible();
  const authCookies = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(authCookies).toEqual([]);
  await page.reload();
  await expect(nav.getByRole("link", { name: "Sign In", exact: true })).toBeVisible();
});

test("Sign in with Google starts OAuth with a callback that carries next", async ({ page }) => {
  await page.route("**/auth/v1/authorize**", (route) => route.fulfill({ status: 200, body: "stub" }));
  await page.goto("/signin?next=%2Finvite%2Ftok123");
  const [request] = await Promise.all([
    page.waitForRequest("**/auth/v1/authorize**"),
    page.getByRole("button", { name: "Sign in with Google" }).click(),
  ]);
  const authorize = new URL(request.url());
  expect(authorize.searchParams.get("provider")).toBe("google");
  const redirectTo = new URL(authorize.searchParams.get("redirect_to")!);
  expect(redirectTo.pathname).toBe("/auth/callback");
  expect(redirectTo.searchParams.get("next")).toBe("/invite/tok123");
});

test("the header Sign In link carries the current page as next", async ({ page }) => {
  await page.goto("/tickets");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign In", exact: true }),
  ).toHaveAttribute("href", "/signin?next=%2Ftickets");
});
