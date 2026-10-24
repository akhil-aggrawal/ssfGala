import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA for issue #19: the real Google button keeps the token through OAuth,
// a signed-in guest on a closed gala still gets no form, and every invite
// state meets WCAG AA. Needs a local Supabase and the app with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function one(table: string, row: object): Promise<string> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return (data as { id: string }).id;
}

// A committed table in the given event; returns its raw token.
async function table(eventId: string, sponsorName: string, tierName: string) {
  await db()
    .from("seating_tiers")
    .upsert([{ event_id: eventId, name: tierName, seat_price_cents: 20000, suggested_contribution_cents: 20000 }], {
      onConflict: "event_id,name",
      ignoreDuplicates: true,
    });
  const { data: tier } = await db().from("seating_tiers").select("id").eq("event_id", eventId).eq("name", tierName).single();
  const sponsor = await one("sponsors", { event_id: eventId, display_name: sponsorName, email: "s@example.test" });
  const sp = await one("sponsorships", { event_id: eventId, sponsor_id: sponsor, pledged_cents: 0, status: "committed" });
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await one("sponsored_tables", { event_id: eventId, sponsorship_id: sp, tier_id: tier!.id, invite_token_hash: hash });
  return token;
}

let openToken = "";
let closedToken = "";

test.beforeAll(async () => {
  const active = async () =>
    (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data as
      | { id: string; status: string }
      | null;
  let event = await active();
  if (!event) {
    await db().from("events").insert({ name: "QA invite gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    event = await active();
  }
  if (event!.status !== "open") await db().from("events").update({ status: "open" }).eq("id", event!.id);
  openToken = await table(event!.id, "QA Open Sponsor", "Gold");
  const closedId = await one("events", { name: "QA closed gala", year: 10000 + Math.floor(Math.random() * 1e6), status: "closed" });
  closedToken = await table(closedId, "QA Closed Sponsor", "Silver");
});

const signIn = (page: Page, next: string) =>
  page.goto(`/auth/test-signin?email=${encodeURIComponent(`qa19-${Date.now()}@example.test`)}&next=${encodeURIComponent(next)}`);

test("AC2: Sign in with Google on the invite page sends OAuth a callback that returns to the same token", async ({ page }) => {
  await page.route("**/auth/v1/authorize**", (route) => route.fulfill({ status: 200, body: "stub" }));
  await page.goto(`/invite/${openToken}`);
  const [request] = await Promise.all([
    page.waitForRequest("**/auth/v1/authorize**"),
    page.getByRole("button", { name: "Sign in with Google" }).click(),
  ]);
  const authorize = new URL(request.url());
  expect(authorize.searchParams.get("provider")).toBe("google");
  const redirectTo = new URL(authorize.searchParams.get("redirect_to")!);
  expect(redirectTo.pathname).toBe("/auth/callback");
  expect(redirectTo.searchParams.get("next")).toBe(`/invite/${openToken}`);
});

test("AC4: a signed-in guest on a closed gala's link still gets no registration form", async ({ page }) => {
  await signIn(page, `/invite/${closedToken}`);
  await expect(page).toHaveURL(new RegExp(`/invite/${closedToken}$`));
  await expect(page.getByRole("status")).toContainText("Registration for this gala is closed");
  await expect(page.locator("main form")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Signed in as");
});

for (const state of ["open", "invalid", "closed"] as const) {
  test(`the ${state} invite page meets WCAG AA (axe) at desktop and mobile`, async ({ page }) => {
    const token = state === "open" ? openToken : state === "closed" ? closedToken : randomBytes(32).toString("base64url");
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/invite/${token}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations).toEqual([]);
      const dir = process.env.QA_SHOTS_DIR;
      if (dir && state !== "open") await page.screenshot({ path: `${dir}/${state}-${viewport.width}.png`, fullPage: true });
    }
  });
}
