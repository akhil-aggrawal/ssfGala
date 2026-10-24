import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #16 on top of the pgTAP and unit tests: the /sponsor
// pledge flow end to end, the link-to-hash round trip, a pledge refused after
// the page went stale, and two pledges racing for the last table.
// Needs a local Supabase with pledge_sponsorship() applied and the app started
// with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

type Tiers = Record<"Silver" | "Gold" | "Platinum", string>;
let eventId = "";
let createdEvent = false;
let tiers: Tiers;

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]);
  if (data?.length) {
    eventId = data[0].id as string;
    if (data[0].status !== "open") await db().from("events").update({ status: "open" }).eq("id", eventId);
  } else {
    const { data: ev, error } = await db()
      .from("events")
      .insert({ name: "QA pledge gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id")
      .single();
    expect(error).toBeNull();
    eventId = ev!.id as string;
    createdEvent = true;
  }
  const rows = [
    { name: "Silver", seat_price_cents: 15000, suggested_contribution_cents: 15000, sponsorship_amount_cents: null },
    { name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000, sponsorship_amount_cents: null },
    { name: "Platinum", seat_price_cents: 25000, suggested_contribution_cents: 25000, sponsorship_amount_cents: null },
  ];
  const { error } = await db()
    .from("seating_tiers")
    .upsert(
      rows.map((r) => ({ ...r, event_id: eventId, table_inventory: 0 })),
      { onConflict: "event_id,name" },
    );
  expect(error).toBeNull();
  const { data: t } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  tiers = Object.fromEntries(t!.map((r) => [r.name, r.id])) as Tiers;
});

test.afterAll(async () => {
  if (createdEvent) await db().from("events").update({ status: "closed" }).eq("id", eventId);
});

// Room for exactly `left` more tables in each tier, whatever earlier runs pledged.
async function setTablesLeft(left: Partial<Record<keyof Tiers, number>>) {
  for (const [name, n] of Object.entries(left)) {
    const id = tiers[name as keyof Tiers];
    const { count } = await db()
      .from("sponsored_tables")
      .select("id, sponsorships!inner(status)", { count: "exact", head: true })
      .eq("tier_id", id)
      .eq("sponsorships.status", "committed");
    const { error } = await db().from("seating_tiers").update({ table_inventory: (count ?? 0) + n }).eq("id", id);
    expect(error).toBeNull();
  }
}

async function signIn(page: Page) {
  const email = `qa-sponsor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/sponsor`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  return { id: profile!.id as string, email };
}

async function sponsorshipsOf(userId: string) {
  const { data, error } = await db()
    .from("sponsorships")
    .select("id, pledged_cents, sponsors!inner(user_id), sponsored_tables(tier_id, invite_token_hash)")
    .eq("sponsors.user_id", userId);
  expect(error).toBeNull();
  return data!;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

test("AC1 AC2 AC4: 2 Gold + 1 Silver pledge, links hash to the stored rows, confirmation", async ({ page }) => {
  await setTablesLeft({ Silver: 3, Gold: 3, Platinum: 3 });
  const { id } = await signIn(page);
  await page.goto("/sponsor");
  await page.getByLabel("Gold tables").fill("2");
  await page.getByLabel("Silver tables").fill("1");
  await page.getByLabel("Sponsor name").fill("QA Family");
  await expect(page.getByText("Total pledge:")).toContainText("$5,500");
  await page.getByRole("button", { name: "Confirm pledge" }).click();

  // AC4
  const confirm = page.getByRole("region", { name: /pledge is confirmed/ });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Pledged amount: $5,500");
  await expect(confirm).toContainText("Payment is collected offline");

  // AC1: 3 tables, 3 different tokens
  const links = await confirm.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(links).toHaveLength(3);
  const tokens = links.map((l) => new URL(l).pathname.replace(/^\/invite\//, ""));
  expect(new Set(tokens).size).toBe(3);

  const rows = await sponsorshipsOf(id);
  expect(rows).toHaveLength(1);
  expect(rows[0].pledged_cents).toBe(550000);
  const tables = rows[0].sponsored_tables as { tier_id: string; invite_token_hash: string }[];
  expect(tables).toHaveLength(3);
  expect(tables.filter((t) => t.tier_id === tiers.Gold)).toHaveLength(2);

  // AC2: stored value is the hash of the link token, never the token itself
  expect(tables.map((t) => t.invite_token_hash).sort()).toEqual(tokens.map(sha256).sort());
  for (const token of tokens) {
    const { count } = await db()
      .from("sponsored_tables")
      .select("id", { count: "exact", head: true })
      .eq("invite_token_hash", token);
    expect(count).toBe(0);
  }
  const { data: audit } = await db().from("audit_logs").select("after_data").eq("entity_id", rows[0].id);
  expect(audit).toHaveLength(1);
  const auditText = JSON.stringify(audit);
  for (const token of tokens) expect(auditText).not.toContain(token);
});

test("AC3: a pledge past what is left after the page loaded is refused and creates nothing", async ({ page }) => {
  await setTablesLeft({ Silver: 2, Gold: 1 });
  const { id } = await signIn(page);
  await page.goto("/sponsor");
  await page.getByLabel("Silver tables").fill("1");
  await page.getByLabel("Gold tables").fill("1");
  await page.getByLabel("Sponsor name").fill("QA Late Family");

  // Someone else takes the last Gold table while this page is open.
  await setTablesLeft({ Gold: 0 });
  await page.getByRole("button", { name: "Confirm pledge" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Nothing was pledged" })).toContainText("Not enough Gold tables are left (0 available). Nothing was pledged.");
  await expect(page.getByLabel("Sponsor name")).toHaveValue("QA Late Family");
  expect(await sponsorshipsOf(id)).toHaveLength(0);
  const { count } = await db().from("sponsors").select("id", { count: "exact", head: true }).eq("user_id", id);
  expect(count).toBe(0);
});

test("AC3: two pledges racing for the last table — one wins, the other creates nothing", async ({ page }) => {
  await setTablesLeft({ Platinum: 1 });
  const { id } = await signIn(page);
  const call = (n: number) =>
    db().rpc("pledge_sponsorship", {
      p_user_id: id,
      p_event_id: eventId,
      p_display_name: `QA Race ${n}`,
      p_email: "race@example.test",
      p_tables: [{ tier_id: tiers.Platinum, count: 1 }],
      p_token_hashes: [sha256(`race-${n}-${Math.random()}`)],
    });
  const results = await Promise.all([call(1), call(2), call(3)]);
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  for (const r of results.filter((r) => r.error)) expect(r.error!.code).toBe("P0001");
  const rows = await sponsorshipsOf(id);
  expect(rows).toHaveLength(1);
  expect(rows[0].sponsored_tables).toHaveLength(1);
});

test("AC4: /sponsor form and confirmation at desktop, tablet and mobile", async ({ page }) => {
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await setTablesLeft({ Silver: 2, Gold: 2, Platinum: 2 });
    await page.setViewportSize({ width, height });
    await signIn(page);
    await page.goto("/sponsor");
    await expect(page.getByRole("heading", { name: "Sponsor a Table" })).toBeVisible();
    await expect(page.getByLabel("Gold tables")).toBeVisible();
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}-form.png`, fullPage: true });

    await page.getByLabel("Gold tables").fill("2");
    await page.getByLabel("Silver tables").fill("1");
    await page.getByLabel("Sponsor name").fill("QA Family");
    await page.getByRole("button", { name: "Confirm pledge" }).click();
    await expect(page.getByRole("region", { name: /pledge is confirmed/ })).toContainText("Payment is collected offline");
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    await page.context().clearCookies();
  }
});
