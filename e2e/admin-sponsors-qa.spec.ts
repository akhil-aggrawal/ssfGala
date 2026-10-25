import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #27: an admin records a pledge on /admin/sponsors in a
// real browser, the invite links work like the public flow's, the sponsor list
// shows the total and table count, a guest added to a full table flags it
// overbooked, and both creations write audit rows naming the admin.
// Needs a local Supabase with migration 20261024210000 and the app started
// with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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
      .insert({ name: "QA admin sponsors gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
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

// Room for `left` more tables in each tier, whatever earlier runs pledged.
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

async function signIn(page: Page, roles: string[]) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  if (roles.length) {
    const { error } = await db()
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: profile!.id, role })));
    expect(error).toBeNull();
  }
  return { id: profile!.id as string, email };
}

// Record a pledge through the admin form; returns the invite links shown.
async function adminPledge(page: Page, name: string, email: string, counts: Partial<Record<keyof Tiers, number>>) {
  await page.goto("/admin/sponsors");
  await page.getByText("New sponsor pledge").click();
  for (const [tier, n] of Object.entries(counts)) await page.getByLabel(`${tier} tables`).fill(String(n));
  await page.getByLabel("Sponsor name").fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Record pledge" }).click();
  const confirm = page.getByRole("region", { name: "Pledge recorded" });
  await expect(confirm).toBeVisible();
  const links = await confirm.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  return { confirm, links };
}

async function sponsorshipOf(name: string) {
  const { data, error } = await db()
    .from("sponsorships")
    .select("id, pledged_cents, status, sponsors!inner(display_name, user_id), sponsored_tables(id, tier_id, capacity, invite_token_hash)")
    .eq("event_id", eventId)
    .eq("sponsors.display_name", name);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  return data![0] as unknown as {
    id: string;
    pledged_cents: number;
    status: string;
    sponsors: { display_name: string; user_id: string | null };
    sponsored_tables: { id: string; tier_id: string; capacity: number; invite_token_hash: string }[];
  };
}

test("AC1 AC2 AC4: admin pledge matches the public flow, shows in the list, audited", async ({ page }) => {
  await setTablesLeft({ Silver: 3, Gold: 3, Platinum: 3 });
  const { id: adminId } = await signIn(page, ["admin"]);
  const name = `QA Phone ${Math.random().toString(36).slice(2, 8)}`;
  const { confirm, links } = await adminPledge(page, name, `qa-phone-${name.slice(-6)}@example.test`, { Gold: 2, Silver: 1 });

  await expect(confirm).toContainText("Pledged amount: $5,500");
  await expect(confirm).toContainText("Payment is collected offline");

  // AC1: one link per table, each token hashes to a stored table, like /sponsor.
  expect(links).toHaveLength(3);
  const tokens = links.map((l) => new URL(l).pathname.replace(/^\/invite\//, ""));
  expect(new Set(tokens).size).toBe(3);
  const admin = await sponsorshipOf(name);
  expect(admin.status).toBe("committed");
  expect(admin.pledged_cents).toBe(550000);
  expect(admin.sponsors.user_id).toBeNull();
  expect(admin.sponsored_tables.map((t) => t.invite_token_hash).sort()).toEqual(tokens.map(sha256).sort());
  expect(admin.sponsored_tables.filter((t) => t.tier_id === tiers.Gold)).toHaveLength(2);

  // The same tables through the public pledge give the same amount and shape.
  await setTablesLeft({ Silver: 1, Gold: 2 });
  const { id: sponsorUser } = await signIn(page, []);
  const publicName = `QA Public ${Math.random().toString(36).slice(2, 8)}`;
  const { data: pub, error } = await db().rpc("pledge_sponsorship", {
    p_user_id: sponsorUser,
    p_event_id: eventId,
    p_display_name: publicName,
    p_email: "qa-public@example.test",
    p_tables: [
      { tier_id: tiers.Gold, count: 2 },
      { tier_id: tiers.Silver, count: 1 },
    ],
    p_token_hashes: [1, 2, 3].map((n) => sha256(`qa-public-${n}-${Math.random()}`)),
  });
  expect(error).toBeNull();
  const viaPublic = await sponsorshipOf(publicName);
  expect(Number((pub as { pledged_cents: number }).pledged_cents)).toBe(admin.pledged_cents);
  const shape = (s: typeof admin) => s.sponsored_tables.map((t) => `${t.tier_id}/${t.capacity}`).sort();
  expect(shape(viaPublic)).toEqual(shape(admin));

  // An admin-issued link opens the invite page for that sponsor.
  await page.context().clearCookies();
  await page.goto(`/invite/${tokens[0]}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/You.re Invited/);
  await expect(page.locator("main")).toContainText(name);

  // AC4: the pledge writes one audit row naming the admin, with no raw token.
  const { data: audit } = await db()
    .from("audit_logs")
    .select("action, actor_id, after_data")
    .eq("entity_id", admin.id);
  expect(audit).toHaveLength(1);
  expect(audit![0].action).toBe("sponsorship.admin_pledge");
  expect(audit![0].actor_id).toBe(adminId);
  for (const token of tokens) expect(JSON.stringify(audit)).not.toContain(token);

  // AC2: the list shows the pledged total and the table count.
  await signIn(page, ["admin"]);
  await page.goto("/admin/sponsors");
  const row = page.getByRole("table", { name: "Sponsors" }).getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("$5,500.00");
  await expect(row.getByRole("cell").nth(2)).toHaveText("3");
});

test("AC3 AC4: a guest added to a full table is accepted, flagged overbooked, audited", async ({ page }) => {
  await setTablesLeft({ Platinum: 1 });
  const { id: adminId } = await signIn(page, ["admin"]);
  const name = `QA Full ${Math.random().toString(36).slice(2, 8)}`;
  const { links } = await adminPledge(page, name, `qa-full-${name.slice(-6)}@example.test`, { Platinum: 1 });
  const hash = sha256(new URL(links[0]).pathname.replace(/^\/invite\//, ""));

  // Fill the table to its capacity of 10 through the guest invite path.
  const ten = Array.from({ length: 10 }, (_, i) => ({ full_name: `QA Guest ${i + 1}`, email: `qa-g${i + 1}@example.test` }));
  const { error } = await db().rpc("register_sponsored_guests", {
    p_user_id: adminId,
    p_invite_token_hash: hash,
    p_attendees: ten,
  });
  expect(error).toBeNull();

  await page.goto("/admin/sponsors");
  const section = page.getByRole("region", { name });
  await expect(section).toContainText("Table 1 · Platinum · 10 / 10 guests");
  await expect(section.getByText("Overbooked")).toHaveCount(0);

  await section.getByText("Add a guest").click();
  const form = page.getByRole("form", { name: `Add a guest to ${name} table 1 (Platinum)` });
  await form.getByLabel("Guest name").fill("QA Eleventh");
  await form.getByLabel("Guest email").fill(`qa-eleventh-${name.slice(-6)}@example.test`);
  await form.getByRole("button", { name: "Add guest" }).click();
  await expect(form.getByRole("status")).toHaveText("QA Eleventh added.");

  // AC3: accepted past capacity and shown as overbooked to the admin.
  await page.reload();
  await expect(section).toContainText("Table 1 · Platinum · 11 / 10 guests");
  await expect(section.getByText("Overbooked")).toBeVisible();

  // AC4: the add writes one audit row naming the admin and the guest.
  const { data: reg } = await db()
    .from("attendees")
    .select("registration_id")
    .eq("email", `qa-eleventh-${name.slice(-6)}@example.test`)
    .eq("event_id", eventId);
  expect(reg).toHaveLength(1);
  const { data: audit } = await db()
    .from("audit_logs")
    .select("action, actor_id, after_data")
    .eq("entity_id", reg![0].registration_id);
  expect(audit).toHaveLength(1);
  expect(audit![0].action).toBe("sponsored_guests.admin_add");
  expect(audit![0].actor_id).toBe(adminId);
  expect(JSON.stringify(audit![0].after_data)).toContain("QA Eleventh");

  // The invite page never tells the guest the table is overbooked.
  await page.context().clearCookies();
  await page.goto(links[0]);
  await expect(page.locator("main")).not.toContainText(/overbook|full/i);
});

test("a signed-in user with no role gets the 403 page and no pledge or guest forms", async ({ page }) => {
  await signIn(page, []);
  await page.goto("/admin/sponsors");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record pledge" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add guest" })).toHaveCount(0);
});

test("AC2 AC3: /admin/sponsors at desktop, tablet and mobile", async ({ page }) => {
  await setTablesLeft({ Gold: 1 });
  const { id: adminId } = await signIn(page, ["admin"]);
  const name = `QA Shots ${Math.random().toString(36).slice(2, 8)}`;
  const { links } = await adminPledge(page, name, `qa-shots-${name.slice(-6)}@example.test`, { Gold: 1 });
  const hash = sha256(new URL(links[0]).pathname.replace(/^\/invite\//, ""));
  const eleven = Array.from({ length: 11 }, (_, i) => ({ full_name: `QA Seat ${i + 1}`, email: `qa-s${i + 1}@example.test` }));
  const { error } = await db().rpc("register_sponsored_guests", {
    p_user_id: adminId,
    p_invite_token_hash: hash,
    p_attendees: eleven.slice(0, 10),
  });
  expect(error).toBeNull();
  await db().rpc("register_sponsored_guests", {
    p_user_id: adminId,
    p_invite_token_hash: hash,
    p_attendees: eleven.slice(10),
  });

  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [shot, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/sponsors");
    const section = page.getByRole("region", { name });
    await expect(section.getByText("Overbooked")).toBeVisible();
    await section.getByText("Add a guest").click();
    await section.scrollIntoViewIfNeeded();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) {
      await page.getByRole("table", { name: "Sponsors" }).screenshot({ path: `${dir}/${shot}-sponsors.png` });
      await section.screenshot({ path: `${dir}/${shot}.png` });
    }
  }
});
