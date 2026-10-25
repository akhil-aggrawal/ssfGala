import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "../src/lib/admin/overview";
import { loadReports } from "../src/lib/admin/reports";

// QA coverage for issue #30: an admin's /admin/reports page shows rows and
// totals that match data seeded into the active gala, leaves out cancelled
// guests and failed or refunded payments, and is hidden from a signed-in
// user with no role. Needs a local Supabase and the app started with
// E2E_AUTH=1. QA_SHOTS=<dir> also saves screenshots.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signIn(page: Page, role: "admin" | null) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  if (!role) return;
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role });
  expect(error).toBeNull();
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
    .insert({ name: "QA reports gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdEventId = created!.id as string;
  return createdEventId;
}

async function insert(table: string, rows: object[]) {
  const { data, error } = await db().from(table).insert(rows).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string }[];
}

// One sponsor with a unique name in the active gala:
// - $2,000 pledge, one table of 2 seats with 3 active guests and 1 cancelled
// - offline receipts: $500 received, $700 refunded (corrected away)
// - seat contributions: Ann $50 succeeded, Ben $99 failed, Dee (cancelled) $30 succeeded
async function seedSponsor(eventId: string) {
  const tag = Math.random().toString(36).slice(2, 8);
  const sponsorName = `QA Reports ${tag}`;
  const tableNumber = `QA-${tag}`;
  let { data: tiers } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  if (!tiers?.length) {
    await insert("seating_tiers", [
      { event_id: eventId, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000, table_inventory: 5 },
    ]);
    ({ data: tiers } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId));
  }
  const tier = tiers![0];
  const [{ id: sponsor_id }] = await insert("sponsors", [
    { event_id: eventId, display_name: sponsorName, email: "qa-reports@example.test" },
  ]);
  const [{ id: sponsorship_id }] = await insert("sponsorships", [
    { event_id: eventId, sponsor_id, pledged_cents: 200000, status: "committed" },
  ]);
  const [{ id: table_id }] = await insert("sponsored_tables", [
    {
      event_id: eventId,
      sponsorship_id,
      tier_id: tier.id,
      invite_token_hash: randomUUID(),
      capacity: 2,
      physical_table_number: tableNumber,
    },
  ]);
  const [{ id: registration_id }] = await insert("registrations", [
    { event_id: eventId, kind: "sponsored", tier_id: tier.id, sponsored_table_id: table_id, status: "registered" },
  ]);
  const guest = (name: string, cancelled_at: string | null = null) => ({
    event_id: eventId,
    registration_id,
    full_name: `${name} ${tag}`,
    email: `${name.toLowerCase()}-${tag}@example.test`,
    cancelled_at,
  });
  const now = new Date().toISOString();
  const [ann, ben, , dee] = await insert("attendees", [guest("Ann"), guest("Ben"), guest("Cy"), guest("Dee", now)]);
  const pay = (p: object) => ({
    event_id: eventId,
    registration_id: null,
    sponsorship_id: null,
    provider: "stripe",
    purpose: "seat_contribution",
    amount_cents: 0,
    status: "succeeded",
    received_at: null,
    ...p,
  });
  const [cAnn, cBen, cDee] = await insert("payments", [
    pay({ registration_id, amount_cents: 5000 }),
    pay({ registration_id, amount_cents: 9900, status: "failed" }),
    pay({ registration_id, amount_cents: 3000 }),
    pay({ sponsorship_id, provider: "offline", purpose: "sponsorship", amount_cents: 50000, received_at: now }),
    pay({ sponsorship_id, provider: "offline", purpose: "sponsorship", amount_cents: 70000, status: "refunded", received_at: now }),
  ]);
  await insert("payment_allocations", [
    { event_id: eventId, payment_id: cAnn.id, attendee_id: ann.id, amount_cents: 5000 },
    { event_id: eventId, payment_id: cBen.id, attendee_id: ben.id, amount_cents: 9900 },
    { event_id: eventId, payment_id: cDee.id, attendee_id: dee.id, amount_cents: 3000 },
  ]);
  return { sponsorName, tableNumber, tag, tierName: tier.name as string };
}

const report = (page: Page, title: string) => page.getByRole("table", { name: title });
const row = (page: Page, title: string, header: string) =>
  report(page, title).getByRole("row").filter({ has: page.getByRole("rowheader", { name: header, exact: true }) });
// Waits for the one matching row (the reports stream in), then reads its cells.
async function cells(page: Page, title: string, header: string) {
  const r = row(page, title, header);
  await expect(r).toHaveCount(1);
  return (await r.getByRole("cell").allInnerTexts()).map((t) => t.trim());
}
const totals = (page: Page, title: string) => cells(page, title, "Total");

test("AC1+AC2: seeded sponsor rows and every total match, cancelled and failed left out", async ({ page }) => {
  const eventId = await activeEventId();
  const s = await seedSponsor(eventId);
  await signIn(page, "admin");
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();

  // Seeded sponsor rows.
  expect(await cells(page, "Sponsor pledges", s.sponsorName)).toEqual(["1", "$2,000.00"]);
  expect(await cells(page, "Outstanding balances", s.sponsorName)).toEqual(["$2,000.00", "$500.00", "$1,500.00"]);
  expect(await cells(page, "Offline receipts", s.sponsorName)).toEqual([expect.any(String), "$500.00"]);
  expect(await cells(page, "Guest contributions", s.sponsorName)).toEqual(["1", "$50.00"]);
  expect(await cells(page, "Overbooked tables", s.tableNumber)).toEqual([s.sponsorName, s.tierName, "3", "2"]);

  // Roster: active guests only; Ann paid, Ben's failed payment is not paid.
  const roster = report(page, "Roster");
  await expect(roster.getByRole("rowheader", { name: `Dee ${s.tag}` })).toHaveCount(0);
  expect(await cells(page, "Roster", `Ann ${s.tag}`)).toEqual([
    `ann-${s.tag}@example.test`, s.tierName, "Sponsored", s.sponsorName, s.tableNumber, "Yes",
  ]);
  expect((await cells(page, "Roster", `Ben ${s.tag}`)).at(-1)).toBe("No");
  expect((await cells(page, "Roster", `Cy ${s.tag}`)).at(-1)).toBe("No");

  // Every Total row equals the server computation for the whole active gala.
  const r = await loadReports(db() as never, eventId);
  const n = (v: number) => v.toLocaleString("en-US");
  expect(await totals(page, "Table allocations by tier")).toEqual([
    n(r.tierAllocations.total.inventory), n(r.tierAllocations.total.allocated), n(r.tierAllocations.total.available),
  ]);
  expect(await totals(page, "Sponsor pledges")).toEqual([n(r.pledges.total.tables), formatCents(r.pledges.total.pledgedCents)]);
  expect((await totals(page, "Roster"))[0]).toBe(n(r.roster.length));
  if (r.paidTickets.rows.length) {
    expect(await totals(page, "Paid tickets")).toEqual([n(r.paidTickets.total.seats), formatCents(r.paidTickets.total.amountCents)]);
  }
  expect(await totals(page, "Guest contributions")).toEqual([
    n(r.contributions.total.guests), formatCents(r.contributions.total.amountCents),
  ]);
  if (r.complimentary.rows.length) {
    expect(await totals(page, "Complimentary attendees")).toEqual([n(r.complimentary.total)]);
  }
  expect(await totals(page, "Offline receipts")).toEqual(["", formatCents(r.offlineReceipts.total)]);
  expect(await totals(page, "Outstanding balances")).toEqual([
    formatCents(r.balances.total.pledgedCents),
    formatCents(r.balances.total.receivedCents),
    formatCents(r.balances.total.outstandingCents),
  ]);
  await expect(report(page, "Overbooked tables").getByRole("row")).toHaveCount(r.overbooked.length + 1);

  // The cancelled guest's $30 and Ben's failed $99 are in no contribution total.
  const rowCents = r.contributions.rows.find((c) => c.sponsor === s.sponsorName)?.amountCents;
  expect(rowCents).toBe(5000);
});

test("AC3: a signed-in user with no role gets 403 and no report", async ({ page }) => {
  await signIn(page, null);
  await page.goto("/admin/reports");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Outstanding balances" })).toHaveCount(0);
});

test.describe("screenshots", () => {
  test.skip(!process.env.QA_SHOTS, "set QA_SHOTS=<dir> to capture");
  const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ];
  for (const vp of viewports) {
    test(`capture ${vp.name}`, async ({ browser }) => {
      await activeEventId();
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await signIn(page, "admin");
      await page.goto("/admin/reports");
      await expect(page.getByRole("table", { name: "Table allocations by tier" })).toBeVisible();
      await page.screenshot({ path: `${dir}/ac1-reports-${vp.name}.png` });
      await page.locator("section[aria-labelledby=report-balances]").screenshot({ path: `${dir}/ac2-balances-${vp.name}.png` });
      await signIn(page, null);
      await page.goto("/admin/reports");
      await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
      await page.screenshot({ path: `${dir}/ac3-no-role-403-${vp.name}.png` });
      await context.close();
    });
  }
});
