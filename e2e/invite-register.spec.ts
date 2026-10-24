import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #20: an invited guest registers attendees on a sponsored table with
// no payment. Past ten seats is accepted with the normal confirmation, which
// shows the tier and no table number. Seeds rows with the service role.
// Needs a local Supabase and the app started with E2E_AUTH=1.
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

let token = "";
let tableId = "";

test.beforeAll(async () => {
  // Reuse the active gala and make sure it is open; with none, open one.
  const active = async () =>
    (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data as
      | { id: string; status: string }
      | null;
  let event = await active();
  if (!event) {
    await db().from("events").insert({ name: "QA register gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    event = await active();
  }
  expect(event).not.toBeNull();
  if (event!.status !== "open") await db().from("events").update({ status: "open" }).eq("id", event!.id);
  await db()
    .from("seating_tiers")
    .upsert(
      [{ event_id: event!.id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 }],
      { onConflict: "event_id,name", ignoreDuplicates: true },
    );
  const { data: tier } = await db().from("seating_tiers").select("id").eq("event_id", event!.id).eq("name", "Gold").single();
  const sponsor = await one("sponsors", { event_id: event!.id, display_name: "QA Register Sponsor", email: "s@example.test" });
  const sp = await one("sponsorships", { event_id: event!.id, sponsor_id: sponsor, pledged_cents: 0 });
  token = randomBytes(32).toString("base64url");
  tableId = await one("sponsored_tables", {
    event_id: event!.id,
    sponsorship_id: sp,
    tier_id: tier!.id,
    invite_token_hash: createHash("sha256").update(token).digest("hex"),
    physical_table_number: "7",
  });
});

async function signIn(page: Page, email: string) {
  const next = `/invite/${token}/register`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function register(page: Page, n: number, prefix: string) {
  await page.getByLabel("Number of attendees").selectOption(String(n));
  for (let i = 0; i < n; i++) {
    const group = page.getByRole("group", { name: `Attendee ${i + 1}` });
    await group.getByLabel("Name").fill(`${prefix} Guest ${i + 1}`);
    await group.getByLabel("Email").fill(`${prefix.toLowerCase()}${i + 1}@example.test`);
  }
  await page.getByRole("button", { name: "Register Without Payment" }).click();
}

const attendeesOnTable = async () => {
  const { data } = await db().from("registrations").select("kind, status, attendees(id)").eq("sponsored_table_id", tableId);
  return (data ?? []) as { kind: string; status: string; attendees: { id: string }[] }[];
};

test("signed-out guest is asked to sign in and comes back to the register page", async ({ page }) => {
  await page.goto(`/invite/${token}/register`);
  await expect(page.locator('form input[name="next"]')).toHaveValue(`/invite/${token}/register`);
  await expect(page.getByRole("button", { name: "Register Without Payment" })).toHaveCount(0);
});

test("AC1: 4 attendees need 4 name and email pairs and create 4 attendee rows", async ({ page }) => {
  await signIn(page, `qa-reg-a-${Date.now()}@example.test`);
  await page.getByLabel("Number of attendees").selectOption("4");
  await expect(page.getByRole("group", { name: /Attendee \d/ })).toHaveCount(4);

  // Three filled, the fourth left empty: refused, nothing saved.
  for (let i = 0; i < 3; i++) {
    const group = page.getByRole("group", { name: `Attendee ${i + 1}` });
    await group.getByLabel("Name").fill(`A Guest ${i + 1}`);
    await group.getByLabel("Email").fill(`a${i + 1}@example.test`);
  }
  await page.getByRole("button", { name: "Register Without Payment" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Nothing was saved");
  expect(await attendeesOnTable()).toHaveLength(0);

  await register(page, 4, "A");
  await expect(page.locator("main").getByRole("status")).toContainText("You’re registered");
  const rows = await attendeesOnTable();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "sponsored", status: "registered" });
  expect(rows[0].attendees).toHaveLength(4);
});

test("AC2 + AC3: the 11th attendee is accepted with the normal confirmation, tier only", async ({ page }) => {
  await signIn(page, `qa-reg-b-${Date.now()}@example.test`);
  await register(page, 6, "B"); // 4 + 6 = 10
  await expect(page.locator("main").getByRole("status")).toContainText("You’re registered");

  await page.goto(`/invite/${token}/register`);
  await register(page, 1, "C"); // the 11th
  const done = page.locator("main").getByRole("status");
  await expect(done).toContainText("You’re registered");
  await expect(done).toContainText("1 attendee · Seating tier: Gold");
  // No table number (seeded as 7), and nothing about seats or overbooking.
  await expect(page.locator("main")).not.toContainText(/table (number|#)?\s*7|full|capacity|overbook/i);
  const total = (await attendeesOnTable()).reduce((n, r) => n + r.attendees.length, 0);
  expect(total).toBe(11);
});

test("AC4: the page offers no pledge option", async ({ page }) => {
  await signIn(page, `qa-reg-d-${Date.now()}@example.test`);
  await expect(page.locator("main")).not.toContainText(/pledge/i);
  await expect(page.locator("main input:not([type=hidden]):not([name=attendee_name]):not([name=attendee_email]), main select")).toHaveCount(1);
});

test("register page at desktop, tablet and mobile", async ({ page }) => {
  await signIn(page, `qa-reg-e-${Date.now()}@example.test`);
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/invite/${token}/register`);
    await page.getByLabel("Number of attendees").selectOption("2");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/register-${name}.png`, fullPage: true });
  }
});
