import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";

// Issue #38: the PRD section 7 acceptance scenarios, end to end in one gala.
// Each scenario runs through the real pages as the buyer, sponsor, guest and
// admin would; the database is read only to check what the pages promised.
// Needs a local Supabase and the app started with E2E_AUTH=1,
// INVITE_LINK_SECRET and STRIPE_WEBHOOK_SECRET (this spec signs its webhook
// events with the same secret). Serial: it parks the active gala.
// QA_SHOTS_DIR saves screenshots.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const year = 3000 + Math.floor(Math.random() * 6000);
const tag = Math.random().toString(36).slice(2, 8);
const shots = process.env.QA_SHOTS_DIR;
const SPONSOR = `Acceptance Family ${tag}`;
let eventId = "";
let parked: { id: string; status: string } | null = null;
// Scenario 2's three invite links, by tier; scenarios 3 and 4 build on them.
let links: Record<"Silver" | "Gold" | "Platinum", string>;
const sponsorEmail = `acc-sponsor-${tag}@example.test`;

test.beforeAll(async () => {
  if (shots) mkdirSync(shots, { recursive: true });
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  const { data: event, error } = await db()
    .from("events")
    .insert({ name: `Acceptance gala ${year}`, year, status: "open" })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id;
  const { error: tierError } = await db()
    .from("seating_tiers")
    .insert(
      Object.entries({ Silver: 15000, Gold: 20000, Platinum: 25000 }).map(([name, cents]) => ({
        event_id: eventId,
        name,
        seat_price_cents: cents,
        suggested_contribution_cents: cents,
        table_inventory: 5,
      })),
    );
  if (tierError) throw tierError;
});

test.afterAll(async () => {
  if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

async function signIn(page: Page, who: string, next = "/", email = `acc-${who}-${Date.now()}-${tag}@example.test`) {
  await page.context().clearCookies();
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
  const { data, error } = await db().from("profiles").select("id").eq("email", email).single();
  if (error) throw error;
  return data.id;
}

async function signInAdmin(page: Page) {
  const id = await signIn(page, "admin");
  const { error } = await db().from("user_roles").insert({ user_id: id, role: "admin" });
  if (error) throw error;
  return id;
}

async function shoot(page: Page, name: string) {
  if (!shots) return;
  for (const [vp, width, height] of [
    ["desktop", 1920, 1080],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `no sideways scroll at ${vp}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${shots}/${name}-${vp}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

// A Stripe event signed the way Stripe signs it (t=…,v1=HMAC-SHA256), posted
// to the app's real webhook route.
async function postWebhook(request: APIRequestContext, event: object, secret: string) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return request.post("/api/stripe/webhook", {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` },
  });
}

test("Scenario 1: buying two tickets gives no confirmed registration until the Stripe webhook succeeds", async ({
  page,
  request,
}) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  test.skip(!secret, "set STRIPE_WEBHOOK_SECRET for the app and this spec");
  const buyer = await signIn(page, "buyer", "/tickets");

  await page.goto("/tickets");
  const choose = page.getByRole("form", { name: "Choose tickets" });
  await choose.getByRole("radio", { name: /Gold/ }).check();
  await choose.getByLabel("Quantity").selectOption("2");
  await expect(page.getByText(/^Total:/)).toHaveText("Total: $400");
  await choose.getByRole("button", { name: "Continue" }).click();

  const details = page.getByRole("form", { name: "Attendee details" });
  for (const [n, name] of [
    [1, "Asha Rao"],
    [2, "Ben Li"],
  ] as const) {
    const group = details.getByRole("group", { name: `Attendee ${n}` });
    await group.getByLabel("Name").fill(name);
    await group.getByLabel("Email").fill(`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`);
  }
  await details.getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/tickets\/review$/);
  await expect(page.getByRole("region", { name: "Order review" }).getByText(/^Total:/)).toHaveText("Total: $400");

  const { data: reg, error } = await db()
    .from("registrations")
    .select("id, status")
    .eq("created_by", buyer)
    .single();
  if (error) throw error;
  expect(reg.status).toBe("pending_payment");

  // Pay with Stripe. With a Stripe test-mode key the page hands off to
  // Checkout and stores the pending payment; without one, Stripe refuses and
  // the pending payment row is what a created session would have stored.
  await page.getByRole("button", { name: "Pay with Stripe" }).click();
  const handedOff = await Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 15_000 }).then(
      () => true,
      () => false,
    ),
    page
      .locator(".ticket-review__pay")
      .getByRole("alert")
      .waitFor({ timeout: 15_000 })
      .then(
        () => false,
        () => false,
      ),
  ]);
  let { data: payment } = await db()
    .from("payments")
    .select("stripe_session_id, amount_cents, status")
    .eq("registration_id", reg.id)
    .maybeSingle();
  if (!handedOff) {
    expect(payment).toBeNull();
    const row = { stripe_session_id: `cs_test_acc_${tag}_${Date.now()}`, amount_cents: 40000, status: "pending" };
    const { error: insertError } = await db()
      .from("payments")
      .insert({ ...row, event_id: eventId, registration_id: reg.id, provider: "stripe", purpose: "ticket" });
    if (insertError) throw insertError;
    payment = row;
  }
  expect(payment).toMatchObject({ amount_cents: 40000, status: "pending" });
  const sessionId = payment!.stripe_session_id!;

  // Back from Checkout: the buyer sees Processing, never Confirmed, until the webhook.
  await page.goto(`/tickets/success?session_id=${sessionId}`);
  await expect(page.getByRole("heading", { name: "Processing your payment" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Confirmed");

  const event = (id: string) => ({
    id,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 40000,
        payment_intent: `pi_test_acc_${tag}`,
      },
    },
  });
  const eventId1 = `evt_acc_${tag}_${Date.now()}`;

  // A forged event (wrong signing secret) is refused and confirms nothing.
  const forged = await postWebhook(request, event(eventId1), "whsec_not_the_real_secret");
  expect(forged.status()).toBe(400);
  expect((await db().from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe(
    "pending_payment",
  );
  await expect(page.getByRole("main")).not.toContainText("Confirmed");

  // The signed webhook confirms the order, and the waiting page follows.
  const signed = await postWebhook(request, event(eventId1), secret!);
  expect(signed.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible({ timeout: 10_000 });
  const tickets = page.getByRole("region", { name: "Your tickets" });
  await expect(tickets).toContainText("Gold");
  await expect(tickets.getByRole("listitem")).toHaveText(["Asha Rao", "Ben Li"]);

  const { data: after } = await db()
    .from("registrations")
    .select("status, payments(status, amount_cents)")
    .eq("id", reg.id)
    .single();
  expect(after).toMatchObject({ status: "registered", payments: [{ status: "succeeded", amount_cents: 40000 }] });

  // Stripe's retry of the same event is deduped: nothing changes.
  const replay = await postWebhook(request, event(eventId1), secret!);
  expect(replay.status()).toBe(200);
  const { count } = await db()
    .from("payment_allocations")
    .select("id, payments!inner(registration_id)", { count: "exact", head: true })
    .eq("payments.registration_id", reg.id);
  expect(count).toBe(2);
  await shoot(page, "scenario1-confirmed");
});

const cards = (page: Page) =>
  page.getByRole("list", { name: "Your tables" }).getByRole("listitem").filter({ has: page.getByRole("article") });

test("Scenario 2: a 3-table pledge shows 3 independent links on one dashboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "sponsor", "/sponsor", sponsorEmail);
  await page.goto("/sponsor");
  await page.getByLabel("Silver tables").fill("1");
  await page.getByLabel("Gold tables").fill("1");
  await page.getByLabel("Platinum tables").fill("1");
  await page.getByLabel("Sponsor name").fill(SPONSOR);
  await expect(page.getByText("Total pledge:")).toContainText("$6,000");
  await page.getByRole("button", { name: "Confirm pledge" }).click();

  const confirm = page.getByRole("region", { name: /pledge is confirmed/ });
  await expect(confirm).toBeVisible();
  const pledged = await confirm.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(pledged).toHaveLength(3);
  expect(new Set(pledged).size).toBe(3);

  // One dashboard, three table cards, each copying its own link.
  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(3);
  const copied: Partial<typeof links> = {};
  for (const tier of ["Silver", "Gold", "Platinum"] as const) {
    const card = cards(page).filter({ hasText: tier });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("0 registered / 10 capacity");
    await card.getByRole("button", { name: "Copy Link" }).click();
    await expect(card.getByRole("status")).toHaveText("Copied");
    copied[tier] = await page.evaluate(() => navigator.clipboard.readText());
  }
  links = copied as typeof links;
  expect(Object.values(links).sort()).toEqual([...pledged].sort());

  // Independent: each link opens its own table (scenario 3 then checks a
  // guest on one table counts on that card only).
  for (const tier of ["Silver", "Gold", "Platinum"] as const) {
    await page.goto(links[tier]);
    await expect(page.getByRole("main")).toContainText(SPONSOR);
    await expect(page.getByRole("main")).toContainText(tier);
  }
  await shoot(page, "scenario2-invite");
});

async function registerGuests(page: Page, link: string, names: string[]) {
  await signIn(page, "guest", `${new URL(link).pathname}/register`);
  await page.getByLabel("Number of attendees").selectOption(String(names.length));
  for (const [i, name] of names.entries()) {
    const group = page.getByRole("group", { name: `Attendee ${i + 1}` });
    await group.getByLabel("Name").fill(name);
    await group.getByLabel("Email").fill(`${name.replace(/\W/g, "").toLowerCase()}-${tag}@example.test`);
  }
  await page.getByRole("button", { name: "Register Without Payment" }).click();
}

test("Scenario 3: 4 guests need 4 name and email records; an 11th guest is accepted and flagged in admin", async ({
  page,
}) => {
  test.skip(!links, "needs scenario 2's links");
  const guests = Array.from({ length: 11 }, (_, i) => `Gold Guest ${i + 1}`);

  // Four attendees with one email missing: refused, nothing saved.
  await signIn(page, "guest", `${new URL(links.Gold).pathname}/register`);
  await page.getByLabel("Number of attendees").selectOption("4");
  await expect(page.getByRole("group", { name: /Attendee \d/ })).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const group = page.getByRole("group", { name: `Attendee ${i + 1}` });
    await group.getByLabel("Name").fill(guests[i]);
    if (i < 3) await group.getByLabel("Email").fill(`gold${i + 1}-${tag}@example.test`);
  }
  await page.getByRole("button", { name: "Register Without Payment" }).click();
  await expect(page).toHaveURL(/\/register$/);
  const { count: none } = await db()
    .from("attendees")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .ilike("full_name", "Gold Guest %");
  expect(none).toBe(0);

  // Four complete records: four attendees.
  await registerGuests(page, links.Gold, guests.slice(0, 4));
  await expect(page.getByRole("main").getByRole("status")).toContainText("You’re registered");
  const goldAttendees = async () =>
    (
      await db()
        .from("attendees")
        .select("full_name, email")
        .eq("event_id", eventId)
        .ilike("full_name", "Gold Guest %")
    ).data!;
  const four = await goldAttendees();
  expect(four).toHaveLength(4);
  expect(four.every((a) => a.full_name && a.email)).toBe(true);

  // Up to ten, then the 11th: accepted with the normal confirmation.
  await registerGuests(page, links.Gold, guests.slice(4, 10));
  await expect(page.getByRole("main").getByRole("status")).toContainText("You’re registered");
  await registerGuests(page, links.Gold, guests.slice(10));
  const done = page.getByRole("main").getByRole("status");
  await expect(done).toContainText("You’re registered");
  await expect(page.getByRole("main")).not.toContainText(/full|capacity|overbook/i);
  expect(await goldAttendees()).toHaveLength(11);
  await shoot(page, "scenario3-eleventh-guest");

  // Scenario 2's links stay independent: only the Gold card counts them.
  await signIn(page, "sponsor", "/sponsor/dashboard", sponsorEmail);
  await page.goto("/sponsor/dashboard");
  await expect(cards(page).filter({ hasText: "Gold" })).toContainText("11 registered / 10 capacity");
  await expect(cards(page).filter({ hasText: "Silver" })).toContainText("0 registered / 10 capacity");
  await expect(cards(page).filter({ hasText: "Platinum" })).toContainText("0 registered / 10 capacity");

  // The admin sees the Gold table flagged; the other two tables are not.
  await signInAdmin(page);
  await page.goto("/admin/sponsors");
  const section = page.getByRole("region", { name: SPONSOR });
  await expect(section).toContainText(/Gold · 11 \/ 10 guests/);
  await expect(section.getByText("Overbooked")).toHaveCount(1);
  await page.goto("/admin/tables?show=overbooked");
  const rows = page
    .getByRole("region", { name: "Sponsored tables, scrollable", exact: true })
    .getByRole("row")
    .filter({ hasText: SPONSOR });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Gold");
  await expect(rows.first().getByText("Overbooked")).toBeVisible();
  await shoot(page, "scenario3-admin-overbooked");
});

test("Scenario 4: an admin adds complimentary and offline-paid attendees and records a pledge payment, with no Stripe charge", async ({
  page,
}) => {
  test.skip(!links, "needs scenario 2's pledge");
  const stripe: string[] = [];
  page.on("request", (r) => {
    if (/stripe/i.test(r.url())) stripe.push(`${r.method()} ${r.url()}`);
  });
  const adminId = await signInAdmin(page);
  const compEmail = `comp-${tag}@example.test`;
  const paidEmail = `paid-${tag}@example.test`;

  // Complimentary.
  await page.goto("/admin/attendees/new");
  await page.getByRole("radio", { name: "Complimentary" }).check();
  await page.getByLabel("Tier", { exact: true }).selectOption({ label: "Gold · $200 per seat" });
  await page.getByLabel("Attendee 1 full name").fill("Comp Guest");
  await page.getByLabel("Attendee 1 email").fill(compEmail);
  await page.getByRole("button", { name: "Save attendees" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Added 1 attendee.");

  // Paid offline.
  await page.goto("/admin/attendees/new");
  await page.getByLabel("Paid offline (cash or check)").check();
  await page.getByLabel("Tier", { exact: true }).selectOption({ label: "Silver · $150 per seat" });
  await page.getByLabel("Amount received (USD)").fill("150");
  await page.getByLabel("Attendee 1 full name").fill("Check Payer");
  await page.getByLabel("Attendee 1 email").fill(paidEmail);
  await page.getByRole("button", { name: "Save attendees" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Added 1 attendee.");

  const registrationOf = async (email: string) => {
    const { data } = await db()
      .from("attendees")
      .select("registrations(kind, status, payments(provider, status, amount_cents, recorded_by, stripe_session_id))")
      .eq("event_id", eventId)
      .eq("email", email)
      .single();
    return data!.registrations;
  };
  expect(await registrationOf(compEmail)).toEqual({ kind: "complimentary", status: "registered", payments: [] });
  expect(await registrationOf(paidEmail)).toEqual({
    kind: "offline_paid",
    status: "registered",
    payments: [{ provider: "offline", status: "succeeded", amount_cents: 15000, recorded_by: adminId, stripe_session_id: null }],
  });

  // Scenario 2's $6,000 pledge: record a $2,500 check against it.
  await page.goto("/admin/payments");
  const section = page.getByRole("region", { name: SPONSOR });
  await expect(section).toContainText("$0.00 received of $6,000.00");
  const form = page.getByRole("form", { name: `Record a receipt for ${SPONSOR}` });
  await form.getByLabel("Amount (USD)").fill("2500");
  await form.getByLabel("Received date").fill("2027-01-10");
  await form.getByRole("button", { name: "Record receipt" }).click();
  await expect(form.getByRole("status")).toHaveText("Receipt recorded.");
  await expect(section).toContainText("$2,500.00 received of $6,000.00 · $3,500.00 outstanding");

  const { data: receipts } = await db()
    .from("payments")
    .select("provider, status, amount_cents, recorded_by, stripe_session_id, sponsorships!inner(sponsors!inner(display_name))")
    .eq("sponsorships.sponsors.display_name", SPONSOR);
  expect(
    receipts!.map((r) => ({
      provider: r.provider,
      status: r.status,
      amount_cents: r.amount_cents,
      recorded_by: r.recorded_by,
      stripe_session_id: r.stripe_session_id,
    })),
  ).toEqual([
    { provider: "offline", status: "succeeded", amount_cents: 250000, recorded_by: adminId, stripe_session_id: null },
  ]);

  // No card charge anywhere: no Stripe request, no card field or charge button.
  await expect(page.getByRole("button", { name: /charge|card|stripe/i })).toHaveCount(0);
  await expect(page.locator('input[autocomplete^="cc-"], iframe[src*="stripe"]')).toHaveCount(0);
  expect(stripe).toEqual([]);
  await shoot(page, "scenario4-pledge-receipt");
});
