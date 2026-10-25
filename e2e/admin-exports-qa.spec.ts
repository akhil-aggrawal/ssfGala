import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA for issue #31 (exports), beyond the builder's admin-exports.spec.ts:
// a cancelled attendee stays out of the roster CSV, the workbook holds one
// worksheet per report, every CSV URL is audited by name, and a signed-in
// user with no role gets 403. Needs a local Supabase and E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const REPORTS = [
  "tiers",
  "pledges",
  "roster",
  "tickets",
  "contributions",
  "complimentary",
  "receipts",
  "balances",
  "overbooked",
];

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signIn(page: Page, role: "admin" | null) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  if (role) {
    const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role });
    expect(error).toBeNull();
  }
  return profile!.id as string;
}

let createdEventId: string | null = null;
test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

async function activeEvent() {
  let { data: events } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (!events?.length) {
    const { data, error } = await db()
      .from("events")
      .insert({ name: "E2E exports QA gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id");
    expect(error).toBeNull();
    createdEventId = data![0].id;
    events = data;
  }
  const eventId = events![0].id as string;
  let { data: tiers } = await db().from("seating_tiers").select("id").eq("event_id", eventId);
  if (!tiers?.length) {
    await db().from("seating_tiers").insert({
      event_id: eventId,
      name: "Gold",
      seat_price_cents: 20000,
      suggested_contribution_cents: 20000,
      table_inventory: 5,
    });
    ({ data: tiers } = await db().from("seating_tiers").select("id").eq("event_id", eventId));
  }
  return { eventId, tierId: tiers![0].id as string };
}

async function addAttendee(eventId: string, tierId: string, name: string, cancelled: boolean) {
  const { data: reg, error: regError } = await db()
    .from("registrations")
    .insert({ event_id: eventId, kind: "individual", tier_id: tierId, status: "registered" })
    .select("id")
    .single();
  expect(regError).toBeNull();
  const email = `${name.toLowerCase().replace(/\s+/g, "-")}@example.test`;
  const { error } = await db()
    .from("attendees")
    .insert({
      event_id: eventId,
      registration_id: reg!.id,
      full_name: name,
      email,
      cancelled_at: cancelled ? new Date().toISOString() : null,
    });
  expect(error).toBeNull();
  return email;
}

test("a signed-in user with no role gets 403 from export URLs", async ({ page }) => {
  await signIn(page, null);
  for (const file of ["roster.csv", "reports.xlsx"]) {
    const res = await page.request.get(`/admin/exports/${file}`, { maxRedirects: 0 });
    expect(res.status(), file).toBe(403);
    expect(await res.text(), file).not.toContain("@example.test");
  }
});

test("roster CSV leaves out a cancelled attendee; workbook has one sheet per report", async ({ page }) => {
  const { eventId, tierId } = await activeEvent();
  const tag = Math.random().toString(36).slice(2, 8);
  const liveEmail = await addAttendee(eventId, tierId, `Live Guest ${tag}`, false);
  const goneEmail = await addAttendee(eventId, tierId, `Cancelled Guest ${tag}`, true);
  await signIn(page, "admin");

  const csv = await page.request.get("/admin/exports/roster.csv");
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain(liveEmail);
  expect(text).not.toContain(goneEmail);

  const xlsx = await page.request.get("/admin/exports/reports.xlsx");
  expect(xlsx.status()).toBe(200);
  // ZIP entry names are stored uncompressed: count the distinct worksheet parts.
  const names = new Set((await xlsx.body()).toString("latin1").match(/xl\/worksheets\/sheet\d+\.xml/g));
  expect(names.size).toBe(REPORTS.length);
});

test("every CSV export URL is audited with its report name", async ({ page }) => {
  const { eventId } = await activeEvent();
  const adminId = await signIn(page, "admin");
  for (const report of REPORTS) {
    const res = await page.request.get(`/admin/exports/${report}.csv`);
    expect(res.status(), report).toBe(200);
    expect(res.headers()["cache-control"], report).toContain("no-store");
  }
  const { data: logs } = await db()
    .from("audit_logs")
    .select("after_data")
    .eq("actor_id", adminId)
    .eq("event_id", eventId)
    .eq("action", "report.export")
    .order("id");
  expect(logs!.map((l) => (l.after_data as { report: string }).report)).toEqual(REPORTS);
});

test("exports page lists Excel and nine CSV downloads", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/exports");
  await expect(page.getByRole("heading", { name: "Exports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Excel" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Download CSV: / })).toHaveCount(REPORTS.length);
  const dir = process.env.QA_SHOTS_DIR;
  if (dir) {
    for (const [name, size] of [
      ["desktop", { width: 1920, height: 1080 }],
      ["tablet", { width: 1024, height: 768 }],
      ["mobile", { width: 375, height: 667 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
    }
  }
});

test("the Excel link downloads a ZIP workbook", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/exports");
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel" }).click();
  const download = await pending;
  expect((await readFile(await download.path())).subarray(0, 2).toString("latin1")).toBe("PK");
  // Optional: keep the file so it can be opened in a spreadsheet tool.
  if (process.env.QA_XLSX_OUT) await download.saveAs(process.env.QA_XLSX_OUT);
});
