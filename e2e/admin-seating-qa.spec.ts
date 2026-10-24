import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #28 on top of e2e/admin-seating.spec.ts: the /admin
// overview and /admin/tables agree on Overbooked before and after a move, a
// blank move puts a guest back, and a bad table number saves nothing. Needs a
// local Supabase and the app started with E2E_AUTH=1. Creates an active event
// only when none exists, and archives it afterwards (never deletes).
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function insert(table: string, rows: object[]) {
  const { data, error } = await db().from(table).insert(rows).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string }[];
}

async function signInAdmin(page: Page) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role: "admin" });
  expect(error).toBeNull();
}

let createdEventId: string | undefined;
async function activeEventId() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]).maybeSingle();
  if (data) return data.id as string;
  const [created] = await insert("events", [
    { name: "QA seating gala", year: 5000 + Math.floor(Math.random() * 4000), status: "open" },
  ]);
  createdEventId = created.id;
  return created.id;
}

const tag = Math.random().toString(36).slice(2, 8);
const sponsor = `QA Seating Full ${tag}`;
const guestName = (n: number) => `QA Seat ${tag} ${n}`;
let tableId = "";
let guestIds: string[] = [];

test.beforeAll(async () => {
  const event_id = await activeEventId();
  let { data: tier } = await db().from("seating_tiers").select("id").eq("event_id", event_id).eq("name", "Gold").maybeSingle();
  if (!tier) {
    [tier] = await insert("seating_tiers", [
      { event_id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 },
    ]);
  }
  const [s] = await insert("sponsors", [{ event_id, display_name: sponsor, email: `full-${tag}@example.test` }]);
  const [p] = await insert("sponsorships", [{ event_id, sponsor_id: s.id, pledged_cents: 200000 }]);
  const [t] = await insert("sponsored_tables", [
    { event_id, sponsorship_id: p.id, tier_id: tier!.id, invite_token_hash: randomUUID(), capacity: 2 },
  ]);
  tableId = t.id;
  const [r] = await insert("registrations", [{ event_id, kind: "sponsored", tier_id: tier!.id, sponsored_table_id: t.id }]);
  // Three guests on a table of two: overbooked until one is moved away.
  guestIds = (
    await insert(
      "attendees",
      [1, 2, 3].map((n) => ({ event_id, registration_id: r.id, full_name: guestName(n), email: `qa-seat${n}-${tag}@example.test` })),
    )
  ).map((g) => g.id);
});

test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

const tablesRegion = (page: Page) => page.getByRole("region", { name: "Sponsored tables, scrollable", exact: true });
const tableRow = (page: Page) => tablesRegion(page).getByRole("row").filter({ hasText: sponsor });
const guestRow = (page: Page, n: number) =>
  page.getByRole("region", { name: "Guests, scrollable", exact: true }).getByRole("row").filter({ hasText: guestName(n) });

// Overbooked count each page shows for the whole gala.
async function overbookedOnSeating(page: Page) {
  await page.goto("/admin/tables");
  await expect(tableRow(page)).toHaveCount(1);
  return tablesRegion(page).getByText("Overbooked", { exact: true }).count();
}
async function overbookedOnOverview(page: Page) {
  await page.goto("/admin");
  const dd = page.locator(".admin-metric").filter({ has: page.getByText("Overbooked tables", { exact: true }) }).locator("dd");
  return Number((await dd.innerText()).replace(/,/g, ""));
}

async function move(page: Page, n: number, value: string) {
  await page.goto("/admin/tables");
  const row = guestRow(page, n);
  await row.getByLabel(`Move ${guestName(n)} to table`).fill(value);
  await row.getByRole("button", { name: "Save" }).click();
  return row.getByRole("status");
}

test("AC3: overview and seating agree on Overbooked before and after a move", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/tables");
  await expect(tableRow(page).getByRole("cell").nth(2)).toHaveText("3 / 2Overbooked");
  const before = await overbookedOnSeating(page);
  expect(before).toBeGreaterThanOrEqual(1);
  expect(await overbookedOnOverview(page)).toBe(before);

  await expect(await move(page, 1, "88")).toHaveText("Saved.");
  await page.reload();
  await expect(tableRow(page).getByRole("cell").nth(2)).toHaveText("2 / 2");
  const after = await overbookedOnSeating(page);
  expect(after).toBe(before - 1);
  expect(await overbookedOnOverview(page)).toBe(after);
});

test("AC2: a blank move puts the guest back on the sponsored table", async ({ page }) => {
  await signInAdmin(page);
  await expect(await move(page, 1, "")).toHaveText("Saved.");
  await page.reload();
  await expect(tableRow(page).getByRole("cell").nth(2)).toHaveText("3 / 2Overbooked");
  const { data } = await db().from("attendees").select("assigned_table_number").eq("id", guestIds[0]).single();
  expect(data!.assigned_table_number).toBeNull();
});

test("AC4: a bad table number saves nothing and writes no audit row", async ({ page }) => {
  await signInAdmin(page);
  const audits = async () =>
    (await db().from("audit_logs").select("id").eq("entity_id", guestIds[1])).data?.length ?? 0;
  const before = await audits();
  await expect(await move(page, 2, "#1!")).toHaveText(/Nothing was saved\./);
  expect(await audits()).toBe(before);
  const { data } = await db().from("attendees").select("assigned_table_number").eq("id", guestIds[1]).single();
  expect(data!.assigned_table_number).toBeNull();
});

test("AC4: each move writes its own audit row with before and after", async () => {
  const { data } = await db()
    .from("audit_logs")
    .select("action, before_data, after_data")
    .eq("entity_id", guestIds[0])
    .order("created_at");
  expect(data).toEqual([
    { action: "attendee.move", before_data: { assigned_table_number: null }, after_data: { assigned_table_number: "88" } },
    { action: "attendee.move", before_data: { assigned_table_number: "88" }, after_data: { assigned_table_number: null } },
  ]);
  expect(tableId).not.toBe("");
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
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await signInAdmin(page);
      await page.goto("/admin/tables");
      await expect(tableRow(page)).toHaveCount(1);
      await page.screenshot({ path: `${dir}/${vp.name}.png`, fullPage: true });
      await context.close();
    });
  }

  test("capture the overview and seating after a move", async ({ page }) => {
    const dir = process.env.QA_SHOTS!;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await signInAdmin(page);
    await expect(await move(page, 3, "89")).toHaveText("Saved.");
    await page.reload();
    await expect(tableRow(page).getByRole("cell").nth(2)).toHaveText("2 / 2");
    await page.screenshot({ path: `${dir}/ac3-seating-after-move-desktop.png`, fullPage: true });
    await page.goto("/admin");
    await expect(page.locator(".admin-metric").first()).toBeVisible();
    await page.screenshot({ path: `${dir}/ac3-overview-after-move-desktop.png`, fullPage: true });
    await page.goto("/admin/tables?show=overbooked");
    await page.screenshot({ path: `${dir}/ac3-overbooked-filter-desktop.png`, fullPage: true });
  });
});
