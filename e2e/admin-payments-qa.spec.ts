import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #29: an admin records two partial offline receipts and
// corrects one through /admin/payments in a real browser, the balances and the
// kept history show on the page, and nothing on it charges a card.
// Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signIn(page: Page, roles: string[]) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  if (roles.length) {
    const { error } = await db()
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: profile!.id, role })));
    expect(error).toBeNull();
  }
  return { id: profile!.id as string, email };
}

let createdEventId: string | null = null;

// Archive a gala this spec opened so it does not trip one_active_gala later.
test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

async function activeEventId() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (data?.length) return data[0].id as string;
  const { data: created, error } = await db()
    .from("events")
    .insert({ name: "QA payments gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdEventId = created!.id as string;
  return createdEventId;
}

// A $2,000 pledge from a sponsor with a unique name, in the active gala.
async function pledge(eventId: string) {
  const name = `QA Sponsor ${Math.random().toString(36).slice(2, 8)}`;
  const { data: sponsor, error } = await db()
    .from("sponsors")
    .insert({ event_id: eventId, display_name: name, email: "qa-sponsor@example.test" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const { data: sponsorship, error: e2 } = await db()
    .from("sponsorships")
    .insert({ event_id: eventId, sponsor_id: sponsor!.id, pledged_cents: 200000 })
    .select("id")
    .single();
  expect(e2).toBeNull();
  return { name, sponsorshipId: sponsorship!.id as string };
}

async function record(page: Page, name: string, amount: string, date: string) {
  const form = page.getByRole("form", { name: `Record a receipt for ${name}` });
  await form.getByLabel("Amount (USD)").fill(amount);
  await form.getByLabel("Received date").fill(date);
  await form.getByRole("button", { name: "Record receipt" }).click();
  await expect(form.getByRole("status")).toHaveText("Receipt recorded.");
}

test("AC1–AC4: record $500 + $300, correct $300 to $350, no card action", async ({ page }) => {
  const stripeCalls: string[] = [];
  page.on("request", (r) => {
    if (/stripe\.com/i.test(r.url())) stripeCalls.push(r.url());
  });
  const eventId = await activeEventId();
  const { id: adminId } = await signIn(page, ["admin"]);
  const { name, sponsorshipId } = await pledge(eventId);

  await page.goto("/admin/payments");
  const section = page.getByRole("region", { name });
  await expect(section).toContainText("$0.00 received of $2,000.00");

  await record(page, name, "500", "2027-01-05");
  await record(page, name, "300", "2027-01-12");

  // AC1: two partial receipts show $800 received and $1,200 outstanding.
  await expect(section).toContainText("$800.00 received of $2,000.00 · $1,200.00 outstanding");
  const row = page.getByRole("table").getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("$800.00");
  await expect(row).toContainText("$1,200.00");

  // AC2: each receipt stores amount, received date and recorded_by.
  const { data: rows } = await db()
    .from("payments")
    .select("id, amount_cents, received_at, recorded_by, provider, status")
    .eq("sponsorship_id", sponsorshipId)
    .order("created_at");
  expect(rows!.map((r) => [r.amount_cents, r.received_at, r.recorded_by, r.provider, r.status])).toEqual([
    [50000, "2027-01-05T08:00:00+00:00", adminId, "offline", "succeeded"],
    [30000, "2027-01-12T08:00:00+00:00", adminId, "offline", "succeeded"],
  ]);
  await expect(section).toContainText("$500.00 received Jan 5, 2027 · recorded by");

  // AC3: correcting keeps the original row and writes an audit entry.
  await section.getByText("Correct this receipt").nth(1).click();
  const fix = page.getByRole("form", { name: "Correct $300.00 receipt" });
  await fix.getByLabel(/Correct amount/).fill("350");
  await fix.getByLabel("Received date").fill("2027-01-13");
  await fix.getByRole("button", { name: "Save correction" }).click();
  await expect(section).toContainText("$850.00 received of $2,000.00 · $1,150.00 outstanding");
  await expect(section).toContainText(/\$300\.00 received Jan 12, 2027 · recorded by .* · corrected/);

  const original = rows![1].id as string;
  const { data: kept } = await db().from("payments").select("amount_cents, status").eq("id", original).single();
  expect(kept).toEqual({ amount_cents: 30000, status: "refunded" });
  const { data: audit } = await db()
    .from("audit_logs")
    .select("actor_id, action, before_data, after_data")
    .eq("entity_id", original)
    .eq("action", "sponsorship_receipt.correct");
  expect(audit).toHaveLength(1);
  expect(audit![0].actor_id).toBe(adminId);
  expect((audit![0].before_data as { amount_cents: number }).amount_cents).toBe(30000);
  expect(
    (audit![0].after_data as { replacement: { amount_cents: number } }).replacement.amount_cents,
  ).toBe(35000);

  // AC4: no card or Stripe payment action anywhere on the page.
  const body = (await page.locator("main").innerText()).toLowerCase();
  expect(body).not.toMatch(/stripe|credit card|card number|charge|pay now|checkout/);
  await expect(page.locator('input[autocomplete^="cc-"], iframe[src*="stripe"]')).toHaveCount(0);
  expect(stripeCalls).toEqual([]);

  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [shot, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/payments");
    await section.scrollIntoViewIfNeeded();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await section.screenshot({ path: `${dir}/${shot}.png` });
  }
});

test("a signed-in user with no role gets the 403 page and no receipt forms", async ({ page }) => {
  await signIn(page, []);
  await page.goto("/admin/payments");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record receipt" })).toHaveCount(0);
});
