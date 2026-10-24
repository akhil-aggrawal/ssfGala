import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #7 on top of e2e/auth.spec.ts: the open-redirect
// guard at every entry point, and the Sign In link on the pages users start
// from. Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const ORIGIN = /^http:\/\/localhost:\d+/;
const uniqueEmail = () => `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const testSignIn = (email: string, next: string) =>
  `/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`;
const headerSignIn = (page: Page) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sign In", exact: true });

test.describe("AC2: a next on another origin is ignored", () => {
  for (const next of ["//evil.example/phish", "/\\evil.example", "https:evil.example", "javascript:alert(1)"]) {
    test(`test sign-in drops ${next}`, async ({ page }) => {
      await page.goto(testSignIn(uniqueEmail(), next));
      await expect(page).toHaveURL(new RegExp(`${ORIGIN.source}/$`));
    });
  }

  test("the callback drops an off-origin next on its error path", async ({ page }) => {
    await page.goto(`/auth/callback?next=${encodeURIComponent("https://evil.example/x")}`);
    await expect(page).toHaveURL(new RegExp(`${ORIGIN.source}/signin\\?error=callback&next=%2F$`));
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in did not finish" })).toBeVisible();
  });

  test("the sign-in form posts / when next is on another origin", async ({ page }) => {
    await page.goto(`/signin?next=${encodeURIComponent("https://evil.example/x")}`);
    await expect(page.locator('form input[name="next"]')).toHaveValue("/");
  });

  test("Google OAuth callback drops an off-origin next", async ({ page }) => {
    await page.route("**/auth/v1/authorize**", (route) => route.fulfill({ status: 200, body: "stub" }));
    await page.goto(`/signin?next=${encodeURIComponent("//evil.example")}`);
    const [request] = await Promise.all([
      page.waitForRequest("**/auth/v1/authorize**"),
      page.getByRole("button", { name: "Sign in with Google" }).click(),
    ]);
    const redirectTo = new URL(new URL(request.url()).searchParams.get("redirect_to")!);
    expect(redirectTo.searchParams.get("next")).toBe("/");
  });
});

test.describe("AC1: the user comes back to the page they started on", () => {
  test("Buy Tickets, then Sign In carries /tickets through to the form", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Buy Tickets" }).click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(headerSignIn(page)).toHaveAttribute("href", "/signin?next=%2Ftickets");
    await headerSignIn(page).click();
    await expect(page).toHaveURL(/\/signin\?next=%2Ftickets$/);
    await expect(page.locator('form input[name="next"]')).toHaveValue("/tickets");
  });

  test("an invite link keeps its token and query in the Sign In link", async ({ page }) => {
    await page.goto("/invite/tok123?ref=mail");
    await expect(headerSignIn(page)).toHaveAttribute("href", "/signin?next=%2Finvite%2Ftok123%3Fref%3Dmail");
  });

  test("signing in from an invite link lands back on it", async ({ page }) => {
    await page.goto(testSignIn(uniqueEmail(), "/invite/tok123?ref=mail"));
    await expect(page).toHaveURL(/\/invite\/tok123\?ref=mail$/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByText("Account")).toBeVisible();
  });
});

test.describe("AC4: sign-out on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("the Account menu's Sign out button is on screen and signs out", async ({ page }) => {
    await page.goto(testSignIn(uniqueEmail(), "/"));
    const nav = page.getByRole("navigation", { name: "Main" });
    await nav.getByText("Account").click();
    const signOut = nav.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await signOut.click({ timeout: 5_000 });
    await expect(headerSignIn(page)).toBeVisible();
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
    test(`capture ${vp.name}`, async ({ page }) => {
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/signin?next=%2Finvite%2Ftok123");
      await page.screenshot({ path: `${dir}/signin-${vp.name}.png` });
      await page.goto(testSignIn(uniqueEmail(), "/"));
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByText("Account").click();
      await page.screenshot({ path: `${dir}/account-menu-${vp.name}.png` });
      await page.context().clearCookies();
      await page.reload();
      await expect(headerSignIn(page)).toBeVisible();
      await page.screenshot({ path: `${dir}/signed-out-${vp.name}.png` });
    });
  }
});
