import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #19: /invite/<token> shows the sponsor and tier, sign-in returns to
// the same token, unknown tokens and closed galas show their messages.
// Seeds rows with the service role. Needs a local Supabase and the app
// started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
};

async function one(table: string, row: object): Promise<string> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return (data as { id: string }).id;
}

const activeEvent = async () =>
  (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data as
    | { id: string; status: string }
    | null;

// A table in the given event with its own fresh token; returns the raw token.
async function table(eventId: string, sponsorName: string, tierName: string, status = "committed") {
  await db()
    .from("seating_tiers")
    .upsert(
      [{ event_id: eventId, name: tierName, seat_price_cents: 20000, suggested_contribution_cents: 20000 }],
      { onConflict: "event_id,name", ignoreDuplicates: true },
    );
  const { data: tier } = await db().from("seating_tiers").select("id").eq("event_id", eventId).eq("name", tierName).single();
  const sponsor = await one("sponsors", { event_id: eventId, display_name: sponsorName, email: "s@example.test" });
  const sp = await one("sponsorships", { event_id: eventId, sponsor_id: sponsor, pledged_cents: 0, status });
  const t = newToken();
  await one("sponsored_tables", { event_id: eventId, sponsorship_id: sp, tier_id: tier!.id, invite_token_hash: t.hash });
  return t.token;
}

let openToken = "";

test.beforeAll(async () => {
  // Reuse the active gala and make sure it is open; with none, open one.
  let event = await activeEvent();
  if (!event) {
    await db().from("events").insert({ name: "QA invite gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    event = await activeEvent();
  }
  expect(event).not.toBeNull();
  if (event!.status !== "open") await db().from("events").update({ status: "open" }).eq("id", event!.id);
  openToken = await table(event!.id, "QA Invite Sponsor", "Gold");
});

const shout = (page: Page) => page.getByRole("heading", { level: 1 });

test("AC1: a valid token shows the sponsor name and tier", async ({ page }) => {
  await page.goto(`/invite/${openToken}`);
  await expect(shout(page)).toHaveText("You’re Invited");
  await expect(page.locator("main")).toContainText("QA Invite Sponsor");
  await expect(page.locator("main")).toContainText("Seating tier: Gold");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("AC2: sign-in carries the same token and lands back on it", async ({ page }) => {
  await page.goto(`/invite/${openToken}`);
  const next = await page.locator('form input[name="next"]').inputValue();
  expect(next).toBe(`/invite/${openToken}`);
  // The header link carries it too.
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await expect(page.locator('form input[name="next"]')).toHaveValue(next);
  // Test sign-in stands in for Google and follows the same `next`.
  const email = `qa-invite-${Date.now()}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(new RegExp(`/invite/${openToken}$`));
  await expect(page.locator("main")).toContainText(`Signed in as ${email}`);
  await expect(page.locator("main")).toContainText("QA Invite Sponsor");
});

test("AC3: an unknown or malformed token shows the not-valid message and a contact hint", async ({ page }) => {
  for (const bad of [newToken().token, "nope"]) {
    await page.goto(`/invite/${bad}`);
    await expect(shout(page)).toHaveText("This invitation link is not valid");
    await expect(page.locator("main")).toContainText("contact");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  }
});

test("AC3: a cancelled sponsorship's link is not valid", async ({ page }) => {
  const event = await activeEvent();
  const token = await table(event!.id, "QA Cancelled Sponsor", "Silver", "cancelled");
  await page.goto(`/invite/${token}`);
  await expect(shout(page)).toHaveText("This invitation link is not valid");
});

test("AC4: a closed gala shows a closed message and no form", async ({ page }) => {
  // A closed past gala: not the one active gala, so other specs are untouched.
  const closedId = await one("events", { name: "QA closed gala", year: 10000 + Math.floor(Math.random() * 1e6), status: "closed" });
  const token = await table(closedId, "QA Closed Sponsor", "Platinum");
  await page.goto(`/invite/${token}`);
  await expect(page.locator("main")).toContainText("QA Closed Sponsor");
  await expect(page.locator("main")).toContainText("Platinum");
  await expect(page.getByRole("status")).toContainText("Registration for this gala is closed");
  await expect(page.locator("main form")).toHaveCount(0);
});

test("invite page at desktop, tablet and mobile", async ({ page }) => {
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/invite/${openToken}`);
    await expect(page.locator("main")).toContainText("QA Invite Sponsor");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
});
