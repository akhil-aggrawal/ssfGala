import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #18 QA: paths the Builder's sponsor-share.spec.ts leaves open.
// - AC4 for Copy Invitation Email (the Builder covers Copy Link only).
// - A table pledged before #18 (random token, hash not rebuildable) shows the
//   "Ask the gala team" note and no copy buttons, never a wrong link.
// Needs a local Supabase and the app started with E2E_AUTH=1 and
// INVITE_LINK_SECRET. Runs after sponsor-share.spec.ts seeded tiers.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]);
  expect(data?.length, "an active gala with tiers (run sponsor-share.spec.ts first)").toBeGreaterThan(0);
  const eventId = data![0].id as string;
  const { data: tiers } = await db().from("seating_tiers").select("id").eq("event_id", eventId).eq("name", "Gold");
  expect(tiers?.length).toBe(1);
  const { count } = await db()
    .from("sponsored_tables")
    .select("id, sponsorships!inner(status)", { count: "exact", head: true })
    .eq("tier_id", tiers![0].id)
    .eq("sponsorships.status", "committed");
  await db().from("seating_tiers").update({ table_inventory: (count ?? 0) + 5 }).eq("id", tiers![0].id);
});

// Signs in as a new user and pledges one Gold table; returns its link.
async function pledgeOneGold(page: Page, sponsor: string): Promise<string> {
  const email = `qa-share-qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/sponsor`);
  await page.goto("/sponsor");
  await page.getByLabel("Gold tables").fill("1");
  await page.getByLabel("Sponsor name").fill(sponsor);
  await page.getByRole("button", { name: "Confirm pledge" }).click();
  const confirm = page.getByRole("region", { name: /pledge is confirmed/ });
  await expect(confirm).toBeVisible();
  return confirm.getByRole("textbox").first().inputValue();
}

const card = (page: Page) =>
  page.getByRole("list", { name: "Your tables" }).getByRole("listitem").filter({ has: page.getByRole("article") }).first();

test("AC4: Copy Invitation Email with the clipboard denied shows the whole invitation selected", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
  });
  const link = await pledgeOneGold(page, "QA Denied Invite Family");
  await page.goto("/sponsor/dashboard");
  await card(page).getByRole("button", { name: "Copy Invitation Email" }).click();
  await expect(card(page).getByRole("status")).toContainText("Copy was blocked");

  const manual = card(page).getByLabel("Text to copy");
  const value = await manual.inputValue();
  expect(value).toMatch(/^Subject: /);
  expect(value).toContain("Gold");
  expect(value).toContain("QA Denied Invite Family");
  expect(value).toContain(link);
  const selected = await manual.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
  expect(selected).toBe(value);
});

test("a table pledged before #18 shows the ask-the-team note and no copy buttons", async ({ page }) => {
  const link = await pledgeOneGold(page, "QA Legacy Family");
  const token = link.split("/invite/")[1];
  // Stand in for a pre-#18 random token: the stored hash no longer matches
  // the HMAC of the table id.
  const { createHash, randomBytes } = await import("node:crypto");
  const { data: row } = await db()
    .from("sponsored_tables")
    .select("id")
    .eq("invite_token_hash", createHash("sha256").update(token).digest("hex"))
    .single();
  const legacy = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("hex");
  const { error } = await db().from("sponsored_tables").update({ invite_token_hash: legacy }).eq("id", row!.id);
  expect(error).toBeNull();

  await page.goto("/sponsor/dashboard");
  await expect(card(page)).toContainText("Ask the gala team");
  await expect(card(page).getByRole("button", { name: "Copy Link" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Copy Invitation Email" })).toHaveCount(0);
  await expect(page.getByText(link)).toHaveCount(0);
});
