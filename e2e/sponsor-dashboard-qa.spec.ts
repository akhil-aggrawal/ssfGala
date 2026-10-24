import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #17 QA: ownership and event scope on /sponsor/dashboard beyond the
// Builder's spec. RLS lets an admin read every sponsor's tables, so the page
// must filter on the signed-in user's id; it must also show only the active
// gala. Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

let eventId = "";

const activeEvent = async () =>
  (await db().from("events").select("id").in("status", ["draft", "open"]).maybeSingle()).data?.id as string | undefined;

test.beforeAll(async () => {
  eventId = (await activeEvent()) ?? "";
  if (!eventId) {
    await db()
      .from("events")
      .insert({ name: "QA dashboard gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    eventId = (await activeEvent()) ?? "";
  }
  expect(eventId).not.toBe("");
});

async function one(table: string, row: object): Promise<{ id: string }> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data as { id: string };
}

async function tierId(event: string, name: string) {
  await db()
    .from("seating_tiers")
    .upsert([{ event_id: event, name, seat_price_cents: 20000, suggested_contribution_cents: 20000 }], {
      onConflict: "event_id,name",
      ignoreDuplicates: true,
    });
  const { data } = await db().from("seating_tiers").select("id").eq("event_id", event).eq("name", name).single();
  return data!.id as string;
}

async function signIn(page: Page, label: string, roles: string[] = []) {
  const email = `qa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const id = profile!.id as string;
  if (roles.length) {
    const { error } = await db().from("user_roles").insert(roles.map((role) => ({ user_id: id, role })));
    expect(error).toBeNull();
  }
  return id;
}

// One committed sponsorship with one table at `tier`, plus one guest on it.
async function tableWithGuest(event: string, userId: string, tier: string, guest: string) {
  const tid = await tierId(event, tier);
  const sponsor = await one("sponsors", { event_id: event, user_id: userId, display_name: guest, email: "s@example.test" });
  const sp = await one("sponsorships", { event_id: event, sponsor_id: sponsor.id, pledged_cents: 0 });
  const table = await one("sponsored_tables", {
    event_id: event,
    sponsorship_id: sp.id,
    tier_id: tid,
    invite_token_hash: randomUUID(),
  });
  const reg = await one("registrations", { event_id: event, kind: "sponsored", tier_id: tid, sponsored_table_id: table.id });
  await one("attendees", { event_id: event, registration_id: reg.id, full_name: guest, email: "g@example.test" });
}

const cards = (page: Page) =>
  page.getByRole("list", { name: "Your tables" }).getByRole("listitem").filter({ has: page.getByRole("article") });

test("an admin who sponsors sees only their own table, not every sponsor's", async ({ page }) => {
  const other = await signIn(page, "dash-other");
  await tableWithGuest(eventId, other, "Gold", "Olga OtherSponsor");
  await page.context().clearCookies();

  const me = await signIn(page, "dash-admin", ["admin", "sponsor"]);
  await tableWithGuest(eventId, me, "Platinum", "Mina MyGuest");

  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().getByText("View guests").click();
  await expect(page.getByText("Mina MyGuest")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Olga OtherSponsor");
});

test("an admin with no sponsorships sees the empty state, not other sponsors' tables", async ({ page }) => {
  const other = await signIn(page, "dash-other2");
  await tableWithGuest(eventId, other, "Gold", "Otto OtherSponsor");
  await page.context().clearCookies();

  await signIn(page, "dash-admin-none", ["admin"]);
  await page.goto("/sponsor/dashboard");
  await expect(page.getByRole("list", { name: "Your tables" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "You have no sponsored tables yet" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Otto OtherSponsor");
});

test("a table from a past gala does not show on this gala's dashboard", async ({ page }) => {
  const me = await signIn(page, "dash-past");
  const { data: past, error } = await db()
    .from("events")
    .insert({ name: "QA past gala", year: 10000 + Math.floor(Math.random() * 80000), status: "closed" })
    .select("id")
    .single();
  expect(error).toBeNull();
  await tableWithGuest(past!.id, me, "Silver", "Pat PastGala");
  await tableWithGuest(eventId, me, "Gold", "Cora CurrentGala");

  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().getByText("View guests").click();
  await expect(page.getByText("Cora CurrentGala")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Pat PastGala");
});
