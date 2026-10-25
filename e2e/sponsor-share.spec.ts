import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #18: Copy Link and Copy Invitation Email on each dashboard table card.
// Pledges through /sponsor so the links are signed by the app's own
// INVITE_LINK_SECRET, then checks the dashboard copies the same links. Needs a
// local Supabase and the app started with E2E_AUTH=1 and INVITE_LINK_SECRET.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

type TierName = "Silver" | "Gold" | "Platinum";
let eventId = "";
let eventName = "";
let tiers: Record<TierName, string>;

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]);
  if (data?.length) {
    eventId = data[0].id as string;
    if (data[0].status !== "open") await db().from("events").update({ status: "open" }).eq("id", eventId);
  } else {
    const { data: ev, error } = await db()
      .from("events")
      .insert({ name: "QA share gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id")
      .single();
    expect(error).toBeNull();
    eventId = ev!.id as string;
  }
  eventName = (await db().from("events").select("name").eq("id", eventId).single()).data!.name as string;
  const rows = [
    { name: "Silver", seat_price_cents: 15000 },
    { name: "Gold", seat_price_cents: 20000 },
    { name: "Platinum", seat_price_cents: 25000 },
  ];
  await db()
    .from("seating_tiers")
    .upsert(
      rows.map((r) => ({ ...r, event_id: eventId, suggested_contribution_cents: r.seat_price_cents, table_inventory: 0 })),
      { onConflict: "event_id,name", ignoreDuplicates: true },
    );
  const { data: t } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  tiers = Object.fromEntries(t!.map((r) => [r.name, r.id])) as Record<TierName, string>;
  // Room for this file's pledges, whatever earlier runs took.
  for (const id of Object.values(tiers)) {
    const { count } = await db()
      .from("sponsored_tables")
      .select("id, sponsorships!inner(status)", { count: "exact", head: true })
      .eq("tier_id", id)
      .eq("sponsorships.status", "committed");
    await db().from("seating_tiers").update({ table_inventory: (count ?? 0) + 5 }).eq("id", id);
  }
});

// Signs in, pledges 1 Gold + 1 Silver as `sponsor`, returns the links the
// pledge page showed, in its order (Silver first, then Gold).
async function pledge(page: Page, sponsor: string): Promise<string[]> {
  const email = `qa-share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/sponsor`);
  await page.goto("/sponsor");
  await page.getByLabel("Gold tables").fill("1");
  await page.getByLabel("Silver tables").fill("1");
  await page.getByLabel("Sponsor name").fill(sponsor);
  await page.getByRole("button", { name: "Confirm pledge" }).click();
  const confirm = page.getByRole("region", { name: /pledge is confirmed/ });
  await expect(confirm).toBeVisible();
  return confirm.getByRole("textbox").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

const cards = (page: Page) =>
  page.getByRole("list", { name: "Your tables" }).getByRole("listitem").filter({ has: page.getByRole("article") });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test("AC1 AC3: Copy Link puts exactly that table's link on the clipboard and says Copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const links = await pledge(page, "QA Share Family");
  await page.goto("/sponsor/dashboard");
  await expect(cards(page)).toHaveCount(2);

  const urls: string[] = [];
  for (const i of [0, 1]) {
    const card = cards(page).nth(i);
    await card.getByRole("button", { name: "Copy Link" }).click();
    await expect(card.getByRole("status")).toHaveText("Copied");
    urls.push(await clipboard(page));
  }
  expect(urls.sort()).toEqual([...links].sort());
  expect(urls[0]).not.toBe(urls[1]);
});

test("AC2 AC3: Copy Invitation Email copies subject and body, edits included, and sends nothing", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await pledge(page, "QA Invite Family");
  await page.goto("/sponsor/dashboard");
  // Copying is client-only: no request (no Server Action, no email) leaves the page.
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(`${r.method()} ${r.url()}`);
  });
  const card = cards(page).filter({ hasText: "Gold" }).first();
  await card.getByRole("button", { name: "Copy Link" }).click();
  const url = await clipboard(page);

  await card.getByRole("button", { name: "Copy Invitation Email" }).click();
  await expect(card.getByRole("status")).toHaveText("Copied");
  const text = await clipboard(page);
  expect(text).toMatch(new RegExp(`^Subject: .*${eventName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  expect(text).toContain("Gold");
  expect(text).toContain("QA Invite Family");
  expect(text).toContain(url);

  await card.getByText("Edit invitation").click();
  await card.getByLabel("Subject").fill("Come sit with us");
  await card.getByLabel("Message").fill(`Join our table: ${url}`);
  await card.getByRole("button", { name: "Copy Invitation Email" }).click();
  expect(await clipboard(page)).toBe(`Subject: Come sit with us\n\nJoin our table: ${url}`);
  expect(posts).toEqual([]);
});

test("AC4: with the clipboard denied, the text is shown selected for a manual copy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  });
  const links = await pledge(page, "QA Denied Family");
  await page.goto("/sponsor/dashboard");
  const card = cards(page).first();
  await card.getByRole("button", { name: "Copy Link" }).click();
  await expect(card.getByRole("status")).toContainText("Copy was blocked");
  const manual = card.getByLabel("Text to copy");
  const value = await manual.inputValue();
  expect(links).toContain(value);
  const selected = await manual.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(selected).toBe(value);
});

test("share actions at desktop, tablet and mobile", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  await pledge(page, "QA Share Shots");
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/sponsor/dashboard");
    const card = cards(page).first();
    await card.getByText("Edit invitation").click();
    await card.getByRole("button", { name: "Copy Invitation Email" }).click();
    await expect(card.getByRole("status")).toHaveText("Copied");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  }
});
