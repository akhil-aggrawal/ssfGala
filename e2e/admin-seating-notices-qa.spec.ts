import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA for issue #35 in the browser: Send table assignments on /admin/tables is
// one button with no message field and reports sent and skipped counts, and a
// cancel on /admin/attendees still says Cancelled. with the notice wired in.
// Email bodies are asserted in src/lib/email/seating-notices.db.test.ts.
// Needs a local Supabase and the app started with E2E_AUTH=1 and
// EMAIL_TRANSPORT=memory. Parks the open gala for the run and puts it back;
// its own gala is archived afterwards. Nothing is deleted.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function insert(table: string, rows: object[]) {
  const { data, error } = await db().from(table).insert(rows).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string }[];
}

const tag = Math.random().toString(36).slice(2, 8);
const name = (n: string) => `QA35 ${n} ${tag}`;
let parked: { id: string; status: string } | null = null;
let eventId = "";
let cancelId = "";

async function signInAdmin(page: Page) {
  const email = `qa35-${Date.now()}-${tag}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role: "admin" });
  expect(error).toBeNull();
}

test.beforeAll(async () => {
  parked = (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  [{ id: eventId }] = await insert("events", [
    { name: "QA35 notices gala", year: 30000 + Math.floor(Math.random() * 1e6), status: "open", venue: "ICC Milpitas" },
  ]);
  const event_id = eventId;
  const [tier] = await insert("seating_tiers", [
    { event_id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 },
  ]);
  const [s] = await insert("sponsors", [{ event_id, display_name: `QA35 Sponsor ${tag}`, email: `qa35-sp-${tag}@example.test` }]);
  const [p] = await insert("sponsorships", [{ event_id, sponsor_id: s.id, pledged_cents: 200000 }]);
  const [t] = await insert("sponsored_tables", [
    { event_id, sponsorship_id: p.id, tier_id: tier.id, invite_token_hash: randomUUID(), capacity: 10, physical_table_number: "12" },
  ]);
  const [sponsored] = await insert("registrations", [{ event_id, kind: "sponsored", tier_id: tier.id, sponsored_table_id: t.id }]);
  const [comp] = await insert("registrations", [{ event_id, kind: "complimentary", tier_id: tier.id }]);
  const ids = await insert("attendees", [
    { event_id, registration_id: sponsored.id, full_name: name("Asha"), email: `qa35-asha-${tag}@example.test` },
    { event_id, registration_id: sponsored.id, full_name: name("Ravi"), email: `qa35-ravi-${tag}@example.test`, assigned_table_number: "VIP-1" },
    { event_id, registration_id: comp.id, full_name: name("Dev"), email: `qa35-dev-${tag}@example.test` },
  ]);
  cancelId = ids[2].id;
});

test.afterAll(async () => {
  if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

const sendForm = (page: Page) =>
  page.locator("form").filter({ has: page.getByRole("button", { name: "Send table assignments" }) });

test("AC4: Send table assignments is one button with no message field", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/tables");
  await expect(sendForm(page)).toHaveCount(1);
  await expect(sendForm(page).locator("textarea, select, input:not([type=hidden])")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /message|subject|body/i })).toHaveCount(0);
});

test("AC1 + AC2: a send reports assigned guests sent and the guest without a table skipped", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/tables");
  await sendForm(page).getByRole("button", { name: "Send table assignments" }).click();
  await expect(sendForm(page).getByRole("status")).toHaveText(
    "Sent 2 table assignments. Skipped 1 guest without a table number.",
  );
  if (process.env.QA_SHOTS) {
    mkdirSync(process.env.QA_SHOTS, { recursive: true });
    for (const [label, width, height] of [
      ["desktop", 1920, 1080],
      ["tablet", 1024, 768],
      ["mobile", 375, 667],
    ] as const) {
      await page.setViewportSize({ width, height });
      await sendForm(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${process.env.QA_SHOTS}/ac1-ac2-send-result-${label}.png` });
    }
  }
});

test("AC3: cancelling an attendee goes through with the notice wired in", async ({ page }) => {
  await signInAdmin(page);
  await page.goto(`/admin/attendees?q=${encodeURIComponent(name("Dev"))}`);
  const row = page.getByRole("row").filter({ hasText: name("Dev") });
  await expect(row).toHaveCount(1);
  await row.getByText("Cancel", { exact: true }).click();
  await row.getByRole("button", { name: `Cancel ${name("Dev")}` }).click();
  // Cancelled rows hide by default once the cancel commits.
  await expect(row).toHaveCount(0);
  const { data } = await db().from("attendees").select("cancelled_at").eq("id", cancelId).single();
  expect(data!.cancelled_at).not.toBeNull();
  if (process.env.QA_SHOTS) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByLabel("Show cancelled").check();
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("row").filter({ hasText: name("Dev") })).toContainText("Cancelled");
    await page.screenshot({ path: `${process.env.QA_SHOTS}/ac3-cancelled-desktop.png` });
  }

  // The cancelled guest drops out of the next send.
  await page.goto("/admin/tables");
  await sendForm(page).getByRole("button", { name: "Send table assignments" }).click();
  await expect(sendForm(page).getByRole("status")).toHaveText(
    "Sent 2 table assignments. Skipped 0 guests without a table number.",
  );
});
