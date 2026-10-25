import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";

// QA coverage for issue #12: the attendee details form, the pending order it
// saves, back-and-resubmit, and the review screen, driven in a real browser
// against a local Supabase. Needs the app started with E2E_AUTH=1. Run with
// --workers=1: it parks the active gala. QA_SHOTS_DIR saves screenshots.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const year = 3000 + Math.floor(Math.random() * 6000);
const PRICES = { Silver: 15000, Gold: 21000, Platinum: 25000 };
const shots = process.env.QA_SHOTS_DIR;
let eventId = "";
let parked: { id: string; status: string } | null = null;

test.beforeAll(async () => {
  if (shots) mkdirSync(shots, { recursive: true });
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  const { data: event, error } = await db()
    .from("events")
    .insert({ name: `QA attendees gala ${year}`, year, status: "open" })
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
  if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

async function signIn(page: Page, next: string) {
  const email = `qa12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  const { data, error } = await db().from("profiles").select("id").eq("email", email).single();
  if (error) throw error;
  return data.id as string;
}

async function ordersOf(userId: string) {
  const { data, error } = await db()
    .from("registrations")
    .select("id, kind, status, event_id, seating_tiers!registrations_tier_id_event_id_fkey (name), attendees (full_name, email, cancelled_at, created_at)")
    .eq("created_by", userId);
  if (error) throw error;
  return data.map((r) => ({
    ...r,
    live: r.attendees
      .filter((a) => a.cancelled_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => `${a.full_name} <${a.email}>`),
  }));
}

const form = (page: Page) => page.getByRole("form", { name: "Attendee details" });
const attendee = (page: Page, n: number) => form(page).getByRole("group", { name: `Attendee ${n}` });

async function fill(page: Page, pairs: [string, string][]) {
  for (const [i, [name, email]] of pairs.entries()) {
    await attendee(page, i + 1).getByLabel("Name").fill(name);
    await attendee(page, i + 1).getByLabel("Email").fill(email);
  }
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const [vp, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `no sideways scroll at ${vp}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}/${name}-${vp}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

test("AC1: two tickets need two pairs; empty or invalid email blocks submit inline", async ({ page }) => {
  const userId = await signIn(page, "/tickets/attendees?tier=Gold&quantity=2");
  await expect(page).toHaveURL(/\/tickets\/attendees\?tier=Gold&quantity=2$/);
  await expect(form(page).getByRole("group")).toHaveCount(2);
  await expect(page.getByText(/2 × Gold · \$420/)).toBeVisible();

  // Empty email on attendee 1, bad email and no name on attendee 2.
  await fill(page, [
    ["Asha Rao", ""],
    ["", "ben-at-example"],
  ]);
  await form(page).getByRole("button", { name: "Review" }).click();
  await expect(form(page).getByRole("alert")).toHaveText("Fix the highlighted fields. Nothing was saved.");
  await expect(page).toHaveURL(/\/tickets\/attendees/);
  const email1 = attendee(page, 1).getByLabel("Email");
  await expect(email1).toHaveAttribute("aria-invalid", "true");
  await expect(email1).toHaveAccessibleDescription("Enter an email address.");
  const email2 = attendee(page, 2).getByLabel("Email");
  await expect(email2).toHaveAccessibleDescription("Enter a valid email address, like name@example.com.");
  await expect(email2).toHaveValue("ben-at-example");
  await expect(attendee(page, 2).getByLabel("Name")).toHaveAccessibleDescription("Enter a name.");
  await expect(attendee(page, 1).getByLabel("Name")).toHaveValue("Asha Rao");
  await expect(attendee(page, 1).getByLabel("Name")).not.toHaveAttribute("aria-invalid");
  expect(await ordersOf(userId)).toEqual([]);

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await shoot(page, "ac1-inline-errors");

  // A single-ticket order only asks for one pair.
  await page.goto("/tickets/attendees?tier=Gold&quantity=1");
  await expect(form(page).getByRole("group")).toHaveCount(1);
});

test("AC2-AC4: submit saves one pending order, review shows it, back and resubmit edits it", async ({ page }) => {
  const userId = await signIn(page, "/tickets/attendees?tier=Gold&quantity=2");
  await fill(page, [
    ["Asha Rao", "asha@example.test"],
    ["Ben Li", "ben@example.test"],
  ]);
  await form(page).getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/tickets\/review$/);

  // AC2: one individual registration, pending payment, two attendees.
  const [first, ...others] = await ordersOf(userId);
  expect(others).toEqual([]);
  expect(first).toMatchObject({ kind: "individual", status: "pending_payment", event_id: eventId });
  expect(first.seating_tiers?.name).toBe("Gold");
  expect(first.live).toEqual(["Asha Rao <asha@example.test>", "Ben Li <ben@example.test>"]);

  // AC4: tier, quantity, names and total.
  const review = page.getByRole("region", { name: "Order review" });
  await expect(review.locator("dt", { hasText: "Tier" }).locator("+ dd")).toHaveText("Gold");
  await expect(review.locator("dt", { hasText: "Quantity" }).locator("+ dd")).toHaveText("2");
  await expect(review.getByRole("listitem")).toHaveText([/Asha Rao/, /Ben Li/]);
  await expect(review.getByText(/^Total:/)).toHaveText("Total: $420");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await shoot(page, "ac4-review");

  // AC3a: the review link goes back to a prefilled form; resubmit edits in place.
  await review.getByRole("link", { name: "Back to attendee details" }).click();
  await expect(page).toHaveURL(/\/tickets\/attendees\?tier=Gold&quantity=2$/);
  await expect(attendee(page, 1).getByLabel("Name")).toHaveValue("Asha Rao");
  await expect(attendee(page, 2).getByLabel("Email")).toHaveValue("ben@example.test");
  await shoot(page, "ac3-back-prefilled");
  await attendee(page, 2).getByLabel("Name").fill("Ben Li-Chen");
  await form(page).getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/tickets\/review$/);
  await expect(review.getByRole("listitem")).toHaveText([/Asha Rao/, /Ben Li-Chen/]);
  let orders = await ordersOf(userId);
  expect(orders).toHaveLength(1);
  expect(orders[0].id).toBe(first.id);
  expect(orders[0].live).toEqual(["Asha Rao <asha@example.test>", "Ben Li-Chen <ben@example.test>"]);

  // AC3b: the browser Back button, then resubmit, still edits the same order.
  await page.goBack();
  await expect(page).toHaveURL(/\/tickets\/attendees/);
  await attendee(page, 1).getByLabel("Name").fill("Asha Rao-Singh");
  await attendee(page, 2).getByLabel("Name").fill("Ben Li-Chen");
  await attendee(page, 2).getByLabel("Email").fill("ben@example.test");
  await form(page).getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/tickets\/review$/);
  orders = await ordersOf(userId);
  expect(orders.map((o) => o.id)).toEqual([first.id]);
  expect(orders[0].live).toEqual(["Asha Rao-Singh <asha@example.test>", "Ben Li-Chen <ben@example.test>"]);

  // AC3c: changing to 3 Platinum keeps the same order, adds a seat, and
  // the review total follows the new tier and quantity.
  await page.goto("/tickets/attendees?tier=Platinum&quantity=3");
  await expect(form(page).getByRole("group")).toHaveCount(3);
  await expect(attendee(page, 1).getByLabel("Name")).toHaveValue("Asha Rao-Singh");
  await attendee(page, 3).getByLabel("Name").fill("Cara Dee");
  await attendee(page, 3).getByLabel("Email").fill("cara@example.test");
  await form(page).getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/tickets\/review$/);
  await expect(review.locator("dt", { hasText: "Tier" }).locator("+ dd")).toHaveText("Platinum");
  await expect(review.locator("dt", { hasText: "Quantity" }).locator("+ dd")).toHaveText("3");
  await expect(review.getByText(/^Total:/)).toHaveText("Total: $750");
  orders = await ordersOf(userId);
  expect(orders.map((o) => o.id)).toEqual([first.id]);
  expect(orders[0].seating_tiers?.name).toBe("Platinum");
  expect(orders[0].live).toHaveLength(3);
});

test("review with no pending order goes back to /tickets", async ({ page }) => {
  await signIn(page, "/tickets/review");
  await expect(page).toHaveURL(/\/tickets$/);
});
