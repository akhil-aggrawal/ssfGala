import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #21 (optional seat contribution) in a real browser
// against a local Supabase. Needs the app started with E2E_AUTH=1 and a
// STRIPE_SECRET_KEY that Stripe rejects (QA has no test-mode key), so a
// positive amount exercises the "payment could not start" path: the guests
// stay registered and nothing is charged. The paid and expired webhook paths
// are covered in supabase/tests/seat_contribution_test.sql.
// QA_SHOTS_DIR saves screenshots.
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

const shots = process.env.QA_SHOTS_DIR;
let token = "";
let tableId = "";

test.beforeAll(async () => {
  if (shots) mkdirSync(shots, { recursive: true });
  const active = async () =>
    (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data as
      | { id: string; status: string }
      | null;
  let event = await active();
  if (!event) {
    await db().from("events").insert({ name: "QA contribution gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    event = await active();
  }
  expect(event).not.toBeNull();
  if (event!.status !== "open") await db().from("events").update({ status: "open" }).eq("id", event!.id);
  await db()
    .from("seating_tiers")
    .upsert(
      [{ event_id: event!.id, name: "Silver", seat_price_cents: 15000, suggested_contribution_cents: 15000 }],
      { onConflict: "event_id,name", ignoreDuplicates: true },
    );
  const { data: tier } = await db()
    .from("seating_tiers")
    .select("id, suggested_contribution_cents")
    .eq("event_id", event!.id)
    .eq("name", "Silver")
    .single();
  expect(tier!.suggested_contribution_cents).toBe(15000);
  const sponsor = await one("sponsors", { event_id: event!.id, display_name: "QA Contribution Sponsor", email: "c@example.test" });
  const sp = await one("sponsorships", { event_id: event!.id, sponsor_id: sponsor, pledged_cents: 0 });
  token = randomBytes(32).toString("base64url");
  tableId = await one("sponsored_tables", {
    event_id: event!.id,
    sponsorship_id: sp,
    tier_id: tier!.id,
    invite_token_hash: createHash("sha256").update(token).digest("hex"),
  });
});

async function signIn(page: Page, tag: string) {
  const email = `qa21-${tag}-${Date.now()}@example.test`;
  const next = `/invite/${token}/register`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function fillGuests(page: Page, n: number, prefix: string) {
  await page.getByLabel("Number of attendees").selectOption(String(n));
  for (let i = 0; i < n; i++) {
    const group = page.getByRole("group", { name: `Attendee ${i + 1}` });
    await group.getByLabel("Name").fill(`${prefix} Guest ${i + 1}`);
    await group.getByLabel("Email").fill(`${prefix.toLowerCase()}${i + 1}@example.test`);
  }
}

type Reg = { id: string; status: string; attendees: { id: string }[]; payments: { status: string }[] };
const registrations = async () => {
  const { data, error } = await db()
    .from("registrations")
    .select("id, status, attendees(id), payments(status)")
    .eq("sponsored_table_id", tableId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Reg[];
};

test("AC1: Silver suggests $150 per seat and the amount follows the attendee count", async ({ page }) => {
  await signIn(page, "a");
  const amount = page.getByLabel("Contribution (USD)");
  await expect(amount).toHaveValue("150");
  await expect(page.locator("main")).toContainText("Suggested: $150 per seat");
  for (const [n, want] of [["2", "300"], ["4", "600"], ["1", "150"]] as const) {
    await page.getByLabel("Number of attendees").selectOption(n);
    await expect(amount).toHaveValue(want);
  }
  await page.getByLabel("Number of attendees").selectOption("2");
  if (shots) await page.screenshot({ path: `${shots}/ac1-amount-default.png`, fullPage: true });
});

test("AC1 edge: an amount under $0.50 is refused and nothing is saved", async ({ page }) => {
  const before = (await registrations()).length;
  await signIn(page, "b");
  await fillGuests(page, 1, "Tiny");
  await page.getByLabel("Contribution (USD)").fill("0.25");
  await page.getByRole("button", { name: "Contribute & Register" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("$0.50");
  await expect(page.locator("main").getByRole("alert")).toContainText("Nothing was saved");
  // The guest's own amount and attendees survive the error.
  await expect(page.getByLabel("Contribution (USD)")).toHaveValue("0.25");
  await expect(page.getByRole("group", { name: "Attendee 1" }).getByLabel("Name")).toHaveValue("Tiny Guest 1");
  expect((await registrations()).length).toBe(before);
  if (shots) await page.screenshot({ path: `${shots}/ac1-under-minimum.png`, fullPage: true });
});

test("AC2: $0 Contribute & Register shows a clean confirmation and stores no payment", async ({ page }) => {
  const before = (await registrations()).length;
  await signIn(page, "c");
  await fillGuests(page, 2, "Zero");
  await page.getByLabel("Contribution (USD)").fill("0");
  await page.getByRole("button", { name: "Contribute & Register" }).click();
  const done = page.locator("main").getByRole("status");
  await expect(done).toContainText("You’re registered");
  await expect(done).toContainText("2 attendees");
  // Had Stripe been tried, the confirmation would carry the could-not-pay note.
  await expect(done).not.toContainText(/payment|charged/i);
  await expect(page).toHaveURL(new RegExp(`/invite/${token}/register$`));
  const regs = await registrations();
  expect(regs.length).toBe(before + 1);
  expect(regs.at(-1)).toMatchObject({ status: "registered", payments: [] });
  expect(regs.at(-1)!.attendees).toHaveLength(2);
  if (shots) await page.screenshot({ path: `${shots}/ac2-zero-registered.png`, fullPage: true });
});

test("Register Without Payment ignores whatever is in the amount field", async ({ page }) => {
  const before = (await registrations()).length;
  await signIn(page, "d");
  await fillGuests(page, 1, "Skip");
  await page.getByLabel("Contribution (USD)").fill("not a number");
  await page.getByRole("button", { name: "Register Without Payment" }).click();
  await expect(page.locator("main").getByRole("status")).toContainText("You’re registered");
  const regs = await registrations();
  expect(regs.length).toBe(before + 1);
  expect(regs.at(-1)).toMatchObject({ status: "registered", payments: [] });
});

test("AC3: a positive amount whose Checkout never opens leaves the guests registered and uncharged", async ({ page }) => {
  const before = (await registrations()).length;
  await signIn(page, "e");
  await fillGuests(page, 3, "Payer");
  await expect(page.getByLabel("Contribution (USD)")).toHaveValue("450");
  await page.getByRole("button", { name: "Contribute & Register" }).click();
  const done = page.locator("main").getByRole("status");
  await expect(done).toContainText("You’re registered");
  await expect(done).toContainText("3 attendees");
  await expect(done).toContainText("you have not been charged");
  await expect(done).toContainText("Your registration is saved");
  const regs = await registrations();
  expect(regs.length).toBe(before + 1);
  const reg = regs.at(-1)!;
  expect(reg.status).toBe("registered");
  expect(reg.attendees).toHaveLength(3);
  expect(reg.payments.filter((p) => p.status === "succeeded")).toEqual([]);
  if (shots) await page.screenshot({ path: `${shots}/ac3-checkout-not-started.png`, fullPage: true });
});

test("AC3: the cancel return page says nothing was charged and changes nothing", async ({ page }) => {
  const before = JSON.stringify(await registrations());
  await page.goto("/invite/contribution?status=cancelled");
  await expect(page.locator("main")).toContainText("Your guests are registered");
  await expect(page.locator("main")).toContainText("No contribution was charged");
  if (shots) await page.screenshot({ path: `${shots}/ac3-cancel-return.png`, fullPage: true });
  await page.goto("/invite/contribution?status=paid");
  await expect(page.locator("main")).toContainText("we are confirming it now");
  expect(JSON.stringify(await registrations())).toBe(before);
});

test("contribution form at desktop, tablet and mobile", async ({ page }) => {
  await signIn(page, "f");
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/invite/${token}/register`);
    await page.getByLabel("Number of attendees").selectOption("2");
    await expect(page.getByRole("button", { name: "Contribute & Register" })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  }
});
