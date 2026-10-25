import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #26: the admin attendee list in a real browser.
// Search is scoped to the active gala, edit writes a before/after audit row,
// cancel soft-cancels and keeps payments, cancelled rows hide behind a filter.
// Needs a local Supabase with the #26 migration and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const tag = Math.random().toString(36).slice(2, 8);
const shots = process.env.QA_SHOTS_DIR;
let createdEvent: string | null = null;
const seeded = { eventId: "", payer: "", other: "", archived: "", paymentId: "" };

async function signInAdmin(page: Page) {
  const email = `qa-${Date.now()}-${tag}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role: "admin" });
  expect(error).toBeNull();
}

async function insert<T = { id: string }>(table: string, row: object): Promise<T> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data as T;
}

async function goldTier(eventId: string) {
  const { data } = await db().from("seating_tiers").select("id").eq("event_id", eventId).eq("name", "Gold");
  if (data?.length) return data[0].id as string;
  return (
    await insert("seating_tiers", {
      event_id: eventId,
      name: "Gold",
      seat_price_cents: 20000,
      suggested_contribution_cents: 20000,
    })
  ).id;
}

async function attendee(eventId: string, fullName: string, email: string) {
  const tierId = await goldTier(eventId);
  const reg = await insert("registrations", { event_id: eventId, kind: "individual", tier_id: tierId });
  const a = await insert("attendees", { event_id: eventId, registration_id: reg.id, full_name: fullName, email });
  return { id: a.id, registrationId: reg.id };
}

test.beforeAll(async () => {
  const { data: active } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (active?.length) seeded.eventId = active[0].id;
  else {
    const year = 4000 + Math.floor(Math.random() * 5000);
    seeded.eventId = (await insert("events", { name: "[TEST] QA attendees gala", year, status: "open" })).id;
    createdEvent = seeded.eventId;
  }
  const archived = (
    await insert("events", {
      name: "[TEST] QA archived gala",
      year: 10000 + Math.floor(Math.random() * 80000),
      status: "archived",
    })
  ).id;

  const payer = await attendee(seeded.eventId, `[TEST] Paula Payer ${tag}`, `paula.${tag}@example.test`);
  seeded.payer = payer.id;
  seeded.other = (await attendee(seeded.eventId, `[TEST] Omar Other ${tag}`, `omar.${tag}@corp.test`)).id;
  seeded.archived = (await attendee(archived, `[TEST] Paula Archived ${tag}`, `paula.${tag}@old.test`)).id;

  seeded.paymentId = (
    await insert("payments", {
      event_id: seeded.eventId,
      registration_id: payer.registrationId,
      provider: "offline",
      purpose: "ticket",
      amount_cents: 20000,
      status: "succeeded",
    })
  ).id;
  await insert("payment_allocations", {
    event_id: seeded.eventId,
    payment_id: seeded.paymentId,
    attendee_id: payer.id,
    amount_cents: 20000,
  });
});

test.afterAll(async () => {
  // Leave no active gala behind: it trips one_active_gala for later DB tests.
  if (createdEvent) await db().from("events").update({ status: "archived" }).eq("id", createdEvent);
});

const table = (page: Page) => page.getByRole("region", { name: "Attendees" });
const rowOf = (page: Page, text: string) => table(page).locator("tbody tr").filter({ hasText: text });

async function shoot(page: Page, name: string) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

test("AC1: partial name or email search returns only the active gala's attendees", async ({ page }) => {
  await signInAdmin(page);
  await page.goto(`/admin/attendees?q=${encodeURIComponent(`PAULA PAYER ${tag}`.slice(2))}`);
  await expect(rowOf(page, `Paula Payer ${tag}`)).toHaveCount(1);
  await expect(table(page).locator("tbody tr")).toHaveCount(1);

  await page.getByRole("searchbox", { name: "Search name or email" }).fill(`paula.${tag}@`);
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(new RegExp(`q=paula.${tag}`));
  await expect(rowOf(page, `paula.${tag}@example.test`)).toHaveCount(1);
  // The archived gala's attendee shares the email prefix but must not show.
  await expect(page.getByText(`paula.${tag}@old.test`)).toHaveCount(0);
  await expect(table(page).locator("tbody tr")).toHaveCount(1);

  for (const [name, width, height] of [
    ["ac1-search-desktop", 1920, 1080],
    ["ac1-search-tablet", 1024, 768],
    ["ac1-search-mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(rowOf(page, `Paula Payer ${tag}`)).toHaveCount(1);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${name} page scrolls sideways`).toBeLessThanOrEqual(width);
    await shoot(page, name);
  }
});

test("AC3: editing an attendee writes an audit row with before and after values", async ({ page }) => {
  await signInAdmin(page);
  // Search by the tag so the row still matches after its name and email change.
  await page.goto(`/admin/attendees?q=${tag}`);
  // Locate by attendee id: the row's text changes once the edit saves.
  const row = table(page).locator("tbody tr", { has: page.locator(`#attendee-${seeded.other}-name`) });
  await row.getByText("Edit", { exact: true }).click();
  await row.getByLabel("Name").fill(`[TEST] Omar Fixed ${tag}`);
  await row.getByLabel("Email").fill(`omar.fixed.${tag}@corp.test`);
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved.");
  await expect(row.getByRole("rowheader")).toHaveText(`[TEST] Omar Fixed ${tag}`);
  await shoot(page, "ac3-edit-saved");

  const { data: logs, error } = await db()
    .from("audit_logs")
    .select("action, before_data, after_data")
    .eq("entity_id", seeded.other)
    .eq("action", "attendee.update");
  expect(error).toBeNull();
  expect(logs).toHaveLength(1);
  expect(logs![0].before_data).toMatchObject({ full_name: `[TEST] Omar Other ${tag}`, email: `omar.${tag}@corp.test` });
  expect(logs![0].after_data).toMatchObject({
    full_name: `[TEST] Omar Fixed ${tag}`,
    email: `omar.fixed.${tag}@corp.test`,
  });

  await page.goto(`/admin/attendees?q=omar.fixed.${tag}`);
  await expect(rowOf(page, `Omar Fixed ${tag}`)).toHaveCount(1);
});

test("AC2 + AC4: cancel keeps payments; cancelled rows hide until the filter is ticked", async ({ page }) => {
  await signInAdmin(page);
  await page.goto(`/admin/attendees?q=${tag}`);
  const row = rowOf(page, `Paula Payer ${tag}`);
  await expect(row).toContainText("Paid");
  await row.getByText("Cancel", { exact: true }).click();
  await row.getByRole("button", { name: `Cancel [TEST] Paula Payer ${tag}` }).click();

  // AC4: hidden by default once cancelled.
  await expect(rowOf(page, `Paula Payer ${tag}`)).toHaveCount(0);
  await expect(rowOf(page, `Omar Fixed ${tag}`)).toHaveCount(1);
  await shoot(page, "ac4-cancelled-hidden");

  // AC2: cancelled_at set, payment and allocation untouched.
  const { data: a } = await db().from("attendees").select("cancelled_at").eq("id", seeded.payer).single();
  expect(a!.cancelled_at).not.toBeNull();
  const { data: pay } = await db().from("payments").select("status, amount_cents").eq("id", seeded.paymentId).single();
  expect(pay).toEqual({ status: "succeeded", amount_cents: 20000 });
  const { count } = await db()
    .from("payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("attendee_id", seeded.payer);
  expect(count).toBe(1);

  // AC4: shown with the filter, marked Cancelled, no second cancel offered.
  await page.getByLabel("Show cancelled").check();
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/cancelled=1/);
  const shown = rowOf(page, `Paula Payer ${tag}`);
  await expect(shown).toHaveCount(1);
  await expect(shown).toContainText("Cancelled");
  await expect(shown).toContainText("Paid");
  await expect(shown.getByText("Cancel", { exact: true })).toHaveCount(0);
  await shoot(page, "ac2-ac4-cancelled-shown");
});
