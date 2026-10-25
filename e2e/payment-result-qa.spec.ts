import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";

// QA coverage for issue #15 in a real browser against a local Supabase:
// /tickets/success waits for the webhook (2 s checks for 60 s) and shows
// Confirmed only once the registration is registered; /tickets/cancelled
// offers Try again on the same pending order; neither shows a table number.
// The webhook is stood in for by a service-role status update. Needs the app
// started with E2E_AUTH=1 and a STRIPE_SECRET_KEY Stripe rejects. Run with
// --workers=1: it parks the active gala. QA_SHOTS_DIR saves shots.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    },
  );

const year = 3000 + Math.floor(Math.random() * 6000);
const shots = process.env.QA_SHOTS_DIR;
const TABLE = "T-77";
let eventId = "";
let parked: { id: string; status: string } | null = null;

test.beforeAll(async () => {
  if (shots) mkdirSync(shots, { recursive: true });
  const { data } = await db()
    .from("events")
    .select("id, status")
    .in("status", ["draft", "open"])
    .maybeSingle();
  parked = data;
  if (parked)
    await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  const { data: event, error } = await db()
    .from("events")
    .insert({ name: `QA payment result gala ${year}`, year, status: "open" })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id;
  const { error: tierError } = await db()
    .from("seating_tiers")
    .insert(
      Object.entries({ Silver: 15000, Gold: 20000, Platinum: 25000 }).map(
        ([name, cents]) => ({
          event_id: eventId,
          name,
          seat_price_cents: cents,
          suggested_contribution_cents: cents,
        }),
      ),
    );
  if (tierError) throw tierError;
});

test.afterAll(async () => {
  if (eventId)
    await db().from("events").update({ status: "archived" }).eq("id", eventId);
  if (parked)
    await db()
      .from("events")
      .update({ status: parked.status })
      .eq("id", parked.id);
});

async function signIn(page: Page) {
  const email = `qa15-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(
    `/auth/test-signin?email=${encodeURIComponent(email)}&next=/`,
  );
  const { data: profile, error } = await db()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (error) throw error;
  return profile.id;
}

// Signs in a fresh .test buyer with a pending Gold order for two and a
// pending Stripe payment row, as Pay with Stripe leaves it.
async function buyerWithPaidSession(page: Page) {
  const userId = await signIn(page);
  const { data: registrationId, error: saveError } = await db().rpc(
    "save_pending_ticket_order",
    {
      p_user_id: userId,
      p_tier_name: "Gold",
      p_attendees: [
        { full_name: "Asha Rao", email: "asha@example.test" },
        { full_name: "Ben Li", email: "ben@example.test" },
      ],
    },
  );
  if (saveError) throw saveError;
  const sessionId = `cs_test_qa15_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db()
    .from("payments")
    .insert({
      event_id: eventId,
      registration_id: registrationId as string,
      provider: "stripe",
      purpose: "ticket",
      amount_cents: 40000,
      status: "pending",
      stripe_session_id: sessionId,
    });
  if (error) throw error;
  return { userId, registrationId: registrationId as string, sessionId };
}

// What the webhook does on checkout.session.completed, for this test only.
async function confirm(registrationId: string) {
  const { error } = await db()
    .from("registrations")
    .update({ status: "registered" })
    .eq("id", registrationId);
  if (error) throw error;
}

async function seatAtTable(registrationId: string) {
  const { error } = await db()
    .from("attendees")
    .update({ assigned_table_number: TABLE })
    .eq("registration_id", registrationId);
  if (error) throw error;
}

async function orderState(registrationId: string, userId: string) {
  const { data: attendees, error } = await db()
    .from("attendees")
    .select("id")
    .eq("registration_id", registrationId)
    .is("cancelled_at", null);
  if (error) throw error;
  const { data: regs, error: rErr } = await db()
    .from("registrations")
    .select("id, status")
    .eq("created_by", userId);
  if (rErr) throw rErr;
  return { attendees: attendees.map((a) => a.id).sort(), registrations: regs };
}

// Records when the success page sends each status check (a Server Action
// POST back to /tickets/success), in real time.
function recordStatusChecks(page: Page) {
  const at: number[] = [];
  page.on("request", async (req) => {
    if (
      req.method() !== "POST" ||
      new URL(req.url()).pathname !== "/tickets/success"
    )
      return;
    const now = Date.now();
    if (await req.headerValue("next-action")) at.push(now);
  });
  return at;
}

async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const [vp, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `no sideways scroll at ${vp}`).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `${shots}/${name}-${vp}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

const main = (page: Page) => page.getByRole("main");

test("AC1+AC2: processing until the webhook confirms, then Confirmed with tier and attendees", async ({
  page,
}) => {
  const { registrationId, sessionId } = await buyerWithPaidSession(page);
  await page.goto(`/tickets/success?session_id=${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Processing your payment" }),
  ).toBeVisible();
  await expect(main(page)).not.toContainText("Confirmed");
  await noAxeViolations(page);
  await shoot(page, "ac2-processing");

  await confirm(registrationId);
  // The next 2 s check sees registered and the page re-renders by itself.
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible({
    timeout: 6000,
  });
  const tickets = page.getByRole("region", { name: "Your tickets" });
  await expect(tickets).toContainText("Gold");
  await expect(tickets.getByRole("listitem")).toHaveText([
    "Asha Rao",
    "Ben Li",
  ]);
  await noAxeViolations(page);
  await shoot(page, "ac1-confirmed");
});

test("AC1: a registered order loaded directly shows Confirmed; reload changes nothing", async ({
  page,
}) => {
  const { registrationId, sessionId } = await buyerWithPaidSession(page);
  await confirm(registrationId);
  await page.goto(`/tickets/success?session_id=${sessionId}`);
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
});

test("AC1: another buyer's session id never shows Confirmed", async ({
  page,
  browser,
}) => {
  const { registrationId, sessionId } = await buyerWithPaidSession(page);
  await confirm(registrationId);
  const other = await browser.newPage();
  await signIn(other);
  await other.goto(`/tickets/success?session_id=${sessionId}`);
  await expect(other.getByRole("main")).toContainText(
    "We could not find this payment on your account.",
  );
  await expect(other.getByRole("main")).not.toContainText("Confirmed");
  await expect(other.getByRole("main")).not.toContainText("Asha Rao");
  await other.close();
});

test("AC2: checks every 2 s, 30 times over 60 s, then shows still-processing", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { sessionId } = await buyerWithPaidSession(page);
  const checks = recordStatusChecks(page);
  await page.goto(`/tickets/success?session_id=${sessionId}`);
  const opened = Date.now();
  await expect(
    page.getByRole("heading", { name: "Processing your payment" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Still processing" }),
  ).toBeVisible({ timeout: 75_000 });
  const gaveUp = Date.now() - opened;
  await expect(main(page)).toContainText("You do not need to pay again.");
  await expect(main(page)).not.toContainText("Confirmed");

  // Nothing more is sent once it has given up.
  await page.waitForTimeout(5000);
  expect(checks, "30 checks in all").toHaveLength(30);
  expect(
    checks[0] - opened,
    "first check about 2 s after load",
  ).toBeGreaterThanOrEqual(1500);
  expect(checks[0] - opened, "first check about 2 s after load").toBeLessThan(
    4000,
  );
  const gaps = checks.slice(1).map((t, i) => t - checks[i]);
  for (const gap of gaps) {
    expect(gap, `gaps ${gaps.join(",")}`).toBeGreaterThanOrEqual(1900);
    expect(gap, `gaps ${gaps.join(",")}`).toBeLessThan(3000);
  }
  expect(gaveUp, "gives up after about 60 s").toBeGreaterThanOrEqual(59_000);
  expect(gaveUp, "gives up after about 60 s").toBeLessThan(70_000);
  console.log(
    `AC2 timing: first=${checks[0] - opened}ms gaps=${gaps.join(",")} gaveUp=${gaveUp}ms`,
  );
  await noAxeViolations(page);
  await shoot(page, "ac2-still-processing");
});

test("AC3: cancel page offers Try again on the same order and writes no attendees", async ({
  page,
}) => {
  const { userId, registrationId } = await buyerWithPaidSession(page);
  const before = await orderState(registrationId, userId);
  expect(before.attendees).toHaveLength(2);

  await page.goto("/tickets/cancelled");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Payment Not Completed",
  );
  const order = page.getByRole("region", { name: "Unpaid order" });
  await expect(order).toContainText("Gold");
  await expect(order).toContainText("Total: $400");
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeEnabled();
  // The form carries nothing the browser could change: the server reloads the order.
  const fields = await retry
    .locator("xpath=ancestor::form")
    .locator("input:not([type=hidden][name^='$ACTION'])")
    .count();
  expect(fields).toBe(0);
  await noAxeViolations(page);
  await shoot(page, "ac3-cancel-page");

  // QA has no Stripe test key, so Stripe refuses: the same Pay action runs
  // on the same registration, fails safe, and writes nothing.
  await retry.click();
  await expect(
    page.locator(".ticket-review__pay").getByRole("alert"),
  ).toHaveText(
    "We could not start the payment. You have not been charged. Try again.",
  );
  expect(await orderState(registrationId, userId)).toEqual(before);
  await shoot(page, "ac3-try-again-stripe-refused");
});

test("AC3: cancel page with no unpaid order points back to tickets", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/tickets/cancelled");
  await expect(main(page)).toContainText(
    "There is no unpaid order on your account.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("AC4: neither page shows a table number, even when one is assigned", async ({
  page,
}) => {
  const pending = await buyerWithPaidSession(page);
  await seatAtTable(pending.registrationId);
  await page.goto("/tickets/cancelled");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(main(page)).not.toContainText(TABLE);
  await expect(main(page)).not.toContainText(/table/i);

  await confirm(pending.registrationId);
  await page.goto(`/tickets/success?session_id=${pending.sessionId}`);
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
  await expect(main(page)).not.toContainText(TABLE);
  await expect(main(page)).not.toContainText(/table/i);
  await shoot(page, "ac4-confirmed-no-table");
});

test("the old success URL redirects with its session id", async ({ page }) => {
  const { sessionId } = await buyerWithPaidSession(page);
  await page.goto(`/tickets/checkout/success?session_id=${sessionId}`);
  await expect(page).toHaveURL(
    new RegExp(`/tickets/success\\?session_id=${sessionId}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Processing your payment" }),
  ).toBeVisible();
});
