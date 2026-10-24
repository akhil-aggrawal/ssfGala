import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #28: table numbers, single-guest moves, overbooked badge, audit rows.
// Needs a local Supabase and the app started with E2E_AUTH=1 (see auth.spec.ts).
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

async function signIn(page: Page, roles: string[]) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  for (const role of roles) await db().from("user_roles").insert({ user_id: profile!.id, role });
}

// The one active gala, created (and archived after) when the local DB has none.
let createdEventId: string | undefined;
async function activeEventId() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]).maybeSingle();
  if (data) return data.id as string;
  const [created] = await insert("events", [
    { name: "E2E seating gala", year: 5000 + Math.floor(Math.random() * 4000), status: "open" },
  ]);
  createdEventId = created.id;
  return created.id;
}

const tag = Math.random().toString(36).slice(2, 8);
const busy = `E2E Seating Busy ${tag}`;
const quiet = `E2E Seating Quiet ${tag}`;
const guestName = (n: number) => `Seat Guest ${tag} ${n}`;
let busyTableId = "";
let movedGuestId = "";

test.beforeAll(async () => {
  const event_id = await activeEventId();
  let { data: tier } = await db().from("seating_tiers").select("id").eq("event_id", event_id).eq("name", "Gold").maybeSingle();
  if (!tier) {
    [tier] = await insert("seating_tiers", [
      { event_id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 },
    ]);
  }
  const tier_id = tier!.id;
  const [sBusy, sQuiet] = await insert("sponsors", [
    { event_id, display_name: busy, email: "busy@example.test" },
    { event_id, display_name: quiet, email: "quiet@example.test" },
  ]);
  const [pBusy, pQuiet] = await insert("sponsorships", [
    { event_id, sponsor_id: sBusy.id, pledged_cents: 200000 },
    { event_id, sponsor_id: sQuiet.id, pledged_cents: 200000 },
  ]);
  const table = (sponsorship_id: string) => ({
    event_id,
    sponsorship_id,
    tier_id,
    invite_token_hash: randomUUID(),
    capacity: 2,
  });
  const [tBusy, tQuiet] = await insert("sponsored_tables", [table(pBusy.id), table(pQuiet.id)]);
  busyTableId = tBusy.id;
  const [rBusy, rQuiet] = await insert("registrations", [
    { event_id, kind: "sponsored", tier_id, sponsored_table_id: tBusy.id },
    { event_id, kind: "sponsored", tier_id, sponsored_table_id: tQuiet.id },
  ]);
  const guest = (registration_id: string, n: number) => ({
    event_id,
    registration_id,
    full_name: guestName(n),
    email: `seat${n}-${tag}@example.test`,
  });
  // Three guests on a table of two: overbooked. One on the other: not.
  const [g1] = await insert("attendees", [guest(rBusy.id, 1), guest(rBusy.id, 2), guest(rBusy.id, 3), guest(rQuiet.id, 4)]);
  movedGuestId = g1.id;
});

test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

const tableRow = (page: Page, sponsor: string) =>
  page.getByRole("region", { name: "Sponsored tables" }).getByRole("row").filter({ hasText: sponsor });
const guestRow = (page: Page, n: number) =>
  page.getByRole("region", { name: "Guests" }).getByRole("row").filter({ hasText: guestName(n) });

test("AC1: a table number shows for all of the table's guests", async ({ page }) => {
  await signIn(page, ["admin"]);
  await page.goto("/admin/tables");
  await expect(page.getByRole("heading", { level: 1, name: "Tables & Seating" })).toBeVisible();
  const row = tableRow(page, busy);
  await row.getByLabel(`Table number for ${busy} (Gold)`).fill("41");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  for (const n of [1, 2, 3]) await expect(guestRow(page, n).getByRole("cell").nth(3)).toHaveText("41");
});

test("AC2: moving one guest changes only that guest's table", async ({ page }) => {
  await signIn(page, ["admin"]);
  await page.goto("/admin/tables");
  const row = guestRow(page, 1);
  await row.getByLabel(`Move ${guestName(1)} to table`).fill("42");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(guestRow(page, 1).getByRole("cell").nth(3)).toHaveText("42moved");
  await expect(guestRow(page, 2).getByRole("cell").nth(3)).toHaveText("41");
  await expect(guestRow(page, 3).getByRole("cell").nth(3)).toHaveText("41");
  await expect(tableRow(page, busy).getByLabel(`Table number for ${busy} (Gold)`)).toHaveValue("41");
});

test("AC3: overbooked tables show a badge and the filter lists only them", async ({ page }) => {
  await signIn(page, ["admin"]);
  await page.goto("/admin/tables");
  await expect(tableRow(page, busy).getByText("Overbooked")).toBeVisible();
  await expect(tableRow(page, quiet).getByText("Overbooked")).toHaveCount(0);
  await page.getByRole("link", { name: "Overbooked only" }).click();
  await expect(page).toHaveURL(/show=overbooked/);
  await expect(tableRow(page, busy)).toHaveCount(1);
  await expect(tableRow(page, quiet)).toHaveCount(0);
});

test("AC3: a non-admin never sees the seating page", async ({ page }) => {
  await signIn(page, ["sponsor", "attendee"]);
  await page.goto("/admin/tables");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByText("Overbooked")).toHaveCount(0);
});

test("AC4: the assignment and the move each wrote an audit row", async () => {
  const { data } = await db()
    .from("audit_logs")
    .select("action, entity_id, after_data")
    .in("entity_id", [busyTableId, movedGuestId]);
  expect(data).toEqual(
    expect.arrayContaining([
      { action: "table.assign_number", entity_id: busyTableId, after_data: { physical_table_number: "41" } },
      { action: "attendee.move", entity_id: movedGuestId, after_data: { assigned_table_number: "42" } },
    ]),
  );
});

test("/admin/seating opens Tables & Seating", async ({ page }) => {
  await signIn(page, ["admin"]);
  await page.goto("/admin/seating");
  await expect(page).toHaveURL(/\/admin\/tables$/);
});
