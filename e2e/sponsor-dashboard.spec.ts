import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #17: /sponsor/dashboard shows one card per sponsored table, the
// registered count against capacity, and only the signed-in sponsor's own
// tables. Seeds rows with the service role. Needs a local Supabase and the
// app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

type TierName = "Silver" | "Gold" | "Platinum";
let eventId = "";
let tiers: Record<TierName, string>;

const activeEvent = async () =>
  (await db().from("events").select("id").in("status", ["draft", "open"]).maybeSingle()).data?.id as string | undefined;

test.beforeAll(async () => {
  // Reuse the active gala. With none, open one and leave it open: another
  // spec file may be creating one in parallel, so on a clash read the winner.
  eventId = (await activeEvent()) ?? "";
  if (!eventId) {
    await db()
      .from("events")
      .insert({ name: "QA dashboard gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" });
    eventId = (await activeEvent()) ?? "";
  }
  expect(eventId).not.toBe("");
  const rows = [
    { name: "Silver", seat_price_cents: 15000 },
    { name: "Gold", seat_price_cents: 20000 },
    { name: "Platinum", seat_price_cents: 25000 },
  ];
  // Keep any tier the active gala already has; add the missing ones.
  const { error } = await db()
    .from("seating_tiers")
    .upsert(
      rows.map((r) => ({ ...r, event_id: eventId, suggested_contribution_cents: r.seat_price_cents })),
      { onConflict: "event_id,name", ignoreDuplicates: true },
    );
  expect(error).toBeNull();
  const { data: t } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  tiers = Object.fromEntries(t!.map((r) => [r.name, r.id])) as Record<TierName, string>;
});

async function signIn(page: Page, label: string) {
  const email = `qa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/sponsor/dashboard`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  return profile!.id as string;
}

async function one<T = { id: string }>(table: string, row: object): Promise<T> {
  const { data, error } = await db().from(table).insert(row).select("id").single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data as T;
}

// One sponsorship with a table per tier listed; returns the table ids.
async function pledge(userId: string, name: string, tierNames: TierName[], status = "committed") {
  const sponsor = await one("sponsors", { event_id: eventId, user_id: userId, display_name: name, email: "s@example.test" });
  const sp = await one("sponsorships", { event_id: eventId, sponsor_id: sponsor.id, pledged_cents: 0, status });
  const ids: string[] = [];
  for (const tier of tierNames) {
    const t = await one("sponsored_tables", {
      event_id: eventId,
      sponsorship_id: sp.id,
      tier_id: tiers[tier],
      invite_token_hash: randomUUID(),
    });
    ids.push(t.id);
  }
  return ids;
}

async function register(tableId: string, tier: TierName, names: string[]) {
  const reg = await one("registrations", {
    event_id: eventId,
    kind: "sponsored",
    tier_id: tiers[tier],
    sponsored_table_id: tableId,
  });
  const { error } = await db()
    .from("attendees")
    .insert(names.map((full_name) => ({ event_id: eventId, registration_id: reg.id, full_name, email: `${full_name.replace(/\W/g, "")}@example.test` })));
  expect(error).toBeNull();
}

const cards = (page: Page) => page.getByRole("list", { name: "Your tables" }).getByRole("listitem").filter({ has: page.getByRole("article") });

test("AC1 AC2: 3 tables across 2 sponsorships, 12 guests on one table", async ({ page }) => {
  const userId = await signIn(page, "dash-a");
  const [gold, silver] = await pledge(userId, "QA A first", ["Gold", "Silver"]);
  await pledge(userId, "QA A second", ["Platinum"]);
  await pledge(userId, "QA A cancelled", ["Gold"], "cancelled");
  const guests = Array.from({ length: 12 }, (_, i) => `Gold Guest ${i + 1}`);
  await register(gold, "Gold", guests.slice(0, 5));
  await register(gold, "Gold", guests.slice(5));
  await register(silver, "Silver", ["Silver Guest"]);

  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toContainText("Gold");
  await expect(cards(page).nth(0)).toContainText("12 registered / 10 capacity");
  await expect(cards(page).nth(1)).toContainText("Silver");
  await expect(cards(page).nth(1)).toContainText("1 registered / 10 capacity");
  await expect(cards(page).nth(2)).toContainText("Platinum");
  await expect(cards(page).nth(2)).toContainText("0 registered / 10 capacity");

  await cards(page).nth(0).getByText("View guests").click();
  const list = cards(page).nth(0).getByRole("listitem");
  await expect(list).toHaveCount(12);
  await expect(list.first()).toContainText("Gold Guest");
});

test("AC3: a second sponsor sees none of the first sponsor's tables or guests", async ({ page }) => {
  const a = await signIn(page, "dash-iso-a");
  const [aTable] = await pledge(a, "QA Iso A", ["Gold", "Silver"]);
  await register(aTable, "Gold", ["Alice OnlyA"]);
  await page.context().clearCookies();

  const b = await signIn(page, "dash-iso-b");
  const [bTable] = await pledge(b, "QA Iso B", ["Platinum"]);
  await register(bTable, "Platinum", ["Bob OnlyB"]);

  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("Platinum");
  await cards(page).first().getByText("View guests").click();
  await expect(page.getByText("Bob OnlyB")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Alice OnlyA");
  await expect(page.locator("body")).not.toContainText("Gold");
});

test("AC4: a user with no sponsorships sees an empty state linking to /sponsor", async ({ page }) => {
  await signIn(page, "dash-none");
  await page.goto("/sponsor/dashboard");
  await expect(page.getByRole("list", { name: "Your tables" })).toHaveCount(0);
  const empty = page.getByRole("region", { name: "You have no sponsored tables yet" });
  await expect(empty).toBeVisible();
  const link = empty.getByRole("link", { name: "Sponsor a table" });
  await expect(link).toHaveAttribute("href", "/sponsor");
  await link.click();
  await expect(page).toHaveURL(/\/sponsor$/);
});

test("signed out: /sponsor/dashboard sends the visitor to sign-in", async ({ page }) => {
  await page.goto("/sponsor/dashboard");
  await expect(page).toHaveURL(/\/signin\?next=%2Fsponsor%2Fdashboard/);
});

test("dashboard at desktop, tablet and mobile", async ({ page }) => {
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  const userId = await signIn(page, "dash-shots");
  const [gold] = await pledge(userId, "QA Shots", ["Gold", "Silver", "Platinum"]);
  await register(gold, "Gold", ["Priya Raman", "Daniel Okafor"]);
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/sponsor/dashboard");
    await cards(page).first().getByText("View guests").click();
    await expect(page.getByText("Priya Raman")).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
});
