import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #25: an admin adds complimentary and paid-offline
// attendees through /admin/attendees/new, and the database holds the
// registration, payment and audit rows. The attendees area never calls Stripe.
// Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const tag = () => Math.random().toString(36).slice(2, 8);

async function signInAdmin(page: Page) {
  const email = `qa-${Date.now()}-${tag()}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role: "admin" });
  expect(error).toBeNull();
  return profile!.id as string;
}

// The active gala with its three tiers; created when none exists.
async function activeGala() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]);
  let eventId = data?.[0]?.id as string | undefined;
  if (!eventId) {
    const { data: created, error } = await db()
      .from("events")
      .insert({ name: "QA attendees gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id")
      .single();
    expect(error).toBeNull();
    eventId = created!.id as string;
  }
  const { data: tiers } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  if (!tiers?.length) {
    const { error } = await db()
      .from("seating_tiers")
      .insert(
        [
          ["Silver", 15000],
          ["Gold", 20000],
          ["Platinum", 25000],
        ].map(([name, cents]) => ({
          event_id: eventId,
          name,
          seat_price_cents: cents,
          suggested_contribution_cents: cents,
        })),
      );
    expect(error).toBeNull();
  }
  return eventId;
}

async function registrationFor(email: string) {
  const { data: attendee } = await db()
    .from("attendees")
    .select("registration_id")
    .eq("email", email)
    .single();
  const id = attendee!.registration_id as string;
  const { data: registration } = await db().from("registrations").select("*").eq("id", id).single();
  const { data: payments } = await db().from("payments").select("*").eq("registration_id", id);
  const { data: audits } = await db().from("audit_logs").select("action, actor_id").eq("entity_id", id);
  return { registration: registration!, payments: payments!, audits: audits! };
}

async function fillAttendee(page: Page, n: number, name: string, email: string) {
  await page.getByLabel(`Attendee ${n} full name`).fill(name);
  await page.getByLabel(`Attendee ${n} email`).fill(email);
}

test("AC1 + AC4: a complimentary add is registered, unpaid and audited", async ({ page }) => {
  await activeGala();
  const adminId = await signInAdmin(page);
  const email = `comp-${tag()}@example.test`;

  await page.goto("/admin/attendees");
  await page.getByRole("link", { name: "Add attendees" }).click();
  await expect(page).toHaveURL(/\/admin\/attendees\/new$/);
  await page.getByRole("radio", { name: "Complimentary" }).check();
  await page.getByLabel("Tier", { exact: true }).selectOption({ label: "Gold · $200 per seat" });
  await fillAttendee(page, 1, "[TEST] Comp Guest", email);
  await page.getByRole("button", { name: "Save attendees" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Added 1 attendee.");

  const { registration, payments, audits } = await registrationFor(email);
  expect(registration).toMatchObject({ kind: "complimentary", status: "registered", created_by: adminId });
  expect(payments).toHaveLength(0);
  expect(audits).toEqual([{ action: "registration.create_complimentary", actor_id: adminId }]);
});

test("AC2 + AC4: a paid-offline add stores an offline payment with recorded_by", async ({ page }) => {
  await activeGala();
  const adminId = await signInAdmin(page);
  const first = `paid1-${tag()}@example.test`;

  await page.goto("/admin/attendees/new");
  await page.getByLabel("Paid offline (cash or check)").check();
  await page.getByLabel("Tier").selectOption({ label: "Silver · $150 per seat" });
  await page.getByLabel("Amount received (USD)").fill("300.01");
  await fillAttendee(page, 1, "[TEST] Paid One", first);
  await page.getByRole("button", { name: "Add another attendee" }).click();
  await fillAttendee(page, 2, "[TEST] Paid Two", `paid2-${tag()}@example.test`);
  await page.getByRole("button", { name: "Save attendees" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText("Added 2 attendees.");

  const { registration, payments, audits } = await registrationFor(first);
  expect(registration).toMatchObject({ kind: "offline_paid", status: "registered" });
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({
    provider: "offline",
    purpose: "ticket",
    status: "succeeded",
    amount_cents: 30001,
    recorded_by: adminId,
  });
  const { data: allocations } = await db()
    .from("payment_allocations")
    .select("amount_cents")
    .eq("payment_id", payments[0].id);
  expect(allocations!.map((a) => a.amount_cents).sort()).toEqual([15000, 15001]);
  expect(audits).toEqual([{ action: "registration.create_offline_paid", actor_id: adminId }]);
});

test("AC2: a refused amount keeps the form and saves nothing", async ({ page }) => {
  await activeGala();
  await signInAdmin(page);
  const email = `zero-${tag()}@example.test`;

  await page.goto("/admin/attendees/new");
  await page.getByLabel("Paid offline (cash or check)").check();
  await page.getByLabel("Tier").selectOption({ label: "Gold · $200 per seat" });
  await page.getByLabel("Amount received (USD)").fill("0");
  await fillAttendee(page, 1, "[TEST] Zero", email);
  await page.getByRole("button", { name: "Save attendees" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Amount received must be more than $0. Nothing was saved.");
  await expect(page.getByLabel("Attendee 1 email")).toHaveValue(email);
  const { count } = await db().from("attendees").select("id", { count: "exact", head: true }).eq("email", email);
  expect(count).toBe(0);
});

test("AC3: the attendees area makes no Stripe request; shots at three viewports", async ({ page }) => {
  await activeGala();
  await signInAdmin(page);
  const stripe: string[] = [];
  page.on("request", (r) => {
    if (/stripe/i.test(r.url())) stripe.push(r.url());
  });

  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/attendees");
    await expect(page.getByRole("link", { name: "Add attendees" })).toBeVisible();
    await expect(page.getByRole("button", { name: /charge|card|stripe/i })).toHaveCount(0);
    if (dir) await page.screenshot({ path: `${dir}/list-${name}.png` });

    await page.goto("/admin/attendees/new");
    await page.getByLabel("Paid offline (cash or check)").check();
    await expect(page.getByLabel("Amount received (USD)")).toBeVisible();
    await expect(page.getByRole("button", { name: /charge|card|stripe/i })).toHaveCount(0);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
  expect(stripe).toEqual([]);
});
