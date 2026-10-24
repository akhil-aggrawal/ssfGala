import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Buy Tickets, screen A (#11). Needs a local Supabase and the app started
// with E2E_AUTH=1 (see auth.spec.ts). Serial: it parks the active gala.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const year = 3000 + Math.floor(Math.random() * 6000);
// Not the default $150/$200/$250, so a hard-coded price would fail.
const PRICES = { Silver: 17500, Gold: 22500, Platinum: 30050 };
let eventId = "";
let parked: { id: string; status: string } | null = null;

const setStatus = (status: string) => db().from("events").update({ status }).eq("id", eventId);

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  const { data: event, error } = await db()
    .from("events")
    .insert({ name: `E2E tickets gala ${year}`, year, status: "open" })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id;
  const tiers = Object.entries(PRICES).map(([name, cents]) => ({
    event_id: eventId,
    name,
    seat_price_cents: cents,
    suggested_contribution_cents: cents,
  }));
  const { error: tierError } = await db().from("seating_tiers").insert(tiers);
  if (tierError) throw tierError;
});

test.afterAll(async () => {
  if (eventId) await setStatus("archived");
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

const form = (page: Page) => page.getByRole("form", { name: "Choose tickets" });
const total = (page: Page) => page.getByText(/^Total:/);

test("AC1 tiers and prices come from the database", async ({ page }) => {
  await page.goto("/tickets");
  await expect(form(page).getByText("$175 per seat")).toBeVisible();
  await expect(form(page).getByText("$225 per seat")).toBeVisible();
  await expect(form(page).getByText("$300.50 per seat")).toBeVisible();
  await expect(form(page).getByText("$150 per seat")).toHaveCount(0);
});

test("AC2 the total is price × quantity as quantity changes", async ({ page }) => {
  await page.goto("/tickets");
  await form(page).getByRole("radio", { name: /Gold/ }).check();
  await expect(total(page)).toHaveText("Total: $225");
  await form(page).getByLabel("Quantity").selectOption("3");
  await expect(total(page)).toHaveText("Total: $675");
  await form(page).getByRole("radio", { name: /Platinum/ }).check();
  await expect(total(page)).toHaveText("Total: $901.50");
});

test("AC3 signed out: Continue goes through sign-in and back to /tickets with the choice kept", async ({ page }) => {
  await page.goto("/tickets");
  await form(page).getByRole("radio", { name: /Gold/ }).check();
  await form(page).getByLabel("Quantity").selectOption("2");
  await form(page).getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/signin\?next=/);
  const next = new URL(page.url()).searchParams.get("next")!;
  expect(next).toBe("/tickets?tier=Gold&quantity=2");
  // Google is replaced by the test sign-in, which honours the same `next`.
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  await expect(page).toHaveURL(/\/tickets\?tier=Gold&quantity=2$/);
  await expect(form(page).getByRole("radio", { name: /Gold/ })).toBeChecked();
  await expect(form(page).getByLabel("Quantity")).toHaveValue("2");
  await expect(total(page)).toHaveText("Total: $450");
  // Signed in now: Continue goes on to attendee details with the choice.
  await form(page).getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/tickets\/attendees\?tier=Gold&quantity=2$/);
});

test("AC4 a gala that is not open shows a closed message and no Continue", async ({ page }) => {
  await setStatus("draft");
  try {
    await page.goto("/tickets");
    await expect(page.getByText("Ticket sales are closed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
    await expect(page.getByText("$225 per seat")).toHaveCount(0);
  } finally {
    await setStatus("open");
  }
});
