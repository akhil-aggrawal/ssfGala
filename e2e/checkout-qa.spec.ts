import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";

// QA coverage for issue #13 in a real browser against a local Supabase:
// the Pay with Stripe button on /tickets/review, its fail-safe when Stripe
// refuses (no payment row, no redirect), and the success URL changing
// nothing. Needs the app started with E2E_AUTH=1 and a STRIPE_SECRET_KEY
// Stripe rejects (QA has no test-mode key). The priced session itself is
// covered against the real database in src/lib/tickets/checkout.db.test.ts.
// Run with --workers=1: it parks the active gala. QA_SHOTS_DIR saves shots.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const year = 3000 + Math.floor(Math.random() * 6000);
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
    .insert({ name: `QA checkout gala ${year}`, year, status: "open" })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id;
  const { error: tierError } = await db().from("seating_tiers").insert(
    Object.entries({ Silver: 15000, Gold: 20000, Platinum: 25000 }).map(([name, cents]) => ({
      event_id: eventId,
      name,
      seat_price_cents: cents,
      suggested_contribution_cents: cents,
    })),
  );
  if (tierError) throw tierError;
});

test.afterAll(async () => {
  if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

// Signs in a fresh .test buyer and saves a pending Gold order for two.
async function buyerWithOrder(page: Page) {
  const email = `qa13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile, error } = await db().from("profiles").select("id").eq("email", email).single();
  if (error) throw error;
  const { data: registrationId, error: saveError } = await db().rpc("save_pending_ticket_order", {
    p_user_id: profile.id,
    p_tier_name: "Gold",
    p_attendees: [
      { full_name: "Asha Rao", email: "asha@example.test" },
      { full_name: "Ben Li", email: "ben@example.test" },
    ],
  });
  if (saveError) throw saveError;
  return registrationId as string;
}

async function stateOf(registrationId: string) {
  const { data: reg, error } = await db().from("registrations").select("status").eq("id", registrationId).single();
  if (error) throw error;
  const { data: payments, error: pErr } = await db()
    .from("payments")
    .select("status, stripe_session_id")
    .eq("registration_id", registrationId);
  if (pErr) throw pErr;
  return { status: reg.status, payments };
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

test("review shows Pay with Stripe under the server total, and the form sends no amount", async ({ page }) => {
  await buyerWithOrder(page);
  await page.goto("/tickets/review");
  const review = page.getByRole("region", { name: "Order review" });
  await expect(review.getByText(/^Total:/)).toHaveText("Total: $400");
  const pay = page.getByRole("button", { name: "Pay with Stripe" });
  await expect(pay).toBeEnabled();
  // The pay form carries no price, quantity or tier field the browser could change.
  const fields = await pay.locator("xpath=ancestor::form").locator("input:not([type=hidden][name^='$ACTION'])").count();
  expect(fields).toBe(0);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await shoot(page, "review-pay-button");
});

test("when Stripe refuses, the buyer sees a plain error, stays on review, and no payment is stored", async ({ page }) => {
  const registrationId = await buyerWithOrder(page);
  await page.goto("/tickets/review");
  await page.getByRole("button", { name: "Pay with Stripe" }).click();
  await expect(page.locator(".ticket-review__pay").getByRole("alert")).toHaveText(
    "We could not start the payment. You have not been charged. Try again.",
  );
  await expect(page).toHaveURL(/\/tickets\/review$/);
  expect(await stateOf(registrationId)).toEqual({ status: "pending_payment", payments: [] });
  await shoot(page, "pay-error");
});

test("AC4: opening and reloading the success URL changes nothing", async ({ page }) => {
  const registrationId = await buyerWithOrder(page);
  const { error } = await db().from("payments").insert({
    event_id: eventId,
    registration_id: registrationId,
    provider: "stripe",
    purpose: "ticket",
    amount_cents: 40000,
    status: "pending",
    stripe_session_id: `cs_test_qa13_${Date.now()}`,
  });
  if (error) throw error;
  const before = await stateOf(registrationId);

  const sessionId = before.payments[0].stripe_session_id!;
  await page.goto(`/tickets/checkout/success?session_id=${sessionId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank You");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank You");

  expect(await stateOf(registrationId)).toEqual(before);
  expect(before.status).toBe("pending_payment");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await shoot(page, "ac4-success-page");
});
