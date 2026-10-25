import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #31: CSV and Excel exports at /admin/exports. Needs a local Supabase
// and the app started with E2E_AUTH=1. Seeds one ticket attendee into the
// active gala (opening one if none is active, archived again after).
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signInAs(page: Page, role: "admin" | "sponsor") {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role });
  expect(error).toBeNull();
  return profile!.id as string;
}

let createdEventId: string | null = null;
test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

async function seedAttendee() {
  let { data: events } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (!events?.length) {
    const { data, error } = await db()
      .from("events")
      .insert({ name: "E2E exports gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id");
    expect(error).toBeNull();
    createdEventId = data![0].id;
    events = data;
  }
  const eventId = events![0].id as string;
  let { data: tiers } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId);
  if (!tiers?.length) {
    await db().from("seating_tiers").insert({
      event_id: eventId,
      name: "Gold",
      seat_price_cents: 20000,
      suggested_contribution_cents: 20000,
      table_inventory: 5,
    });
    ({ data: tiers } = await db().from("seating_tiers").select("id, name").eq("event_id", eventId));
  }
  const { data: reg, error: regError } = await db()
    .from("registrations")
    .insert({ event_id: eventId, kind: "individual", tier_id: tiers![0].id, status: "registered" })
    .select("id")
    .single();
  expect(regError).toBeNull();
  const tag = Math.random().toString(36).slice(2, 8);
  const email = `export-${tag}@example.test`;
  const { error } = await db()
    .from("attendees")
    .insert({ event_id: eventId, registration_id: reg!.id, full_name: `Export Guest ${tag}`, email });
  expect(error).toBeNull();
  return { eventId, email, name: `Export Guest ${tag}`, tier: tiers![0].name as string };
}

test("signed out, an export URL goes to sign-in", async ({ page }) => {
  const res = await page.request.get("/admin/exports/roster.csv", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/signin?next=");
});

test("a sponsor gets 403 from every export URL", async ({ page }) => {
  await signInAs(page, "sponsor");
  for (const file of ["roster.csv", "balances.csv", "reports.xlsx"]) {
    const res = await page.request.get(`/admin/exports/${file}`, { maxRedirects: 0 });
    expect(res.status(), file).toBe(403);
    expect(await res.text(), file).not.toContain("@example.test");
  }
});

test("an admin downloads the roster CSV and the Excel workbook, each audited", async ({ page }) => {
  const guest = await seedAttendee();
  const adminId = await signInAs(page, "admin");
  await page.goto("/admin/exports");

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV: Roster" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toBe("ssf-gala-roster.csv");
  const text = await readFile(await csv.path(), "utf8");
  expect(text.split("\r\n")[0]).toBe("﻿Name,Email,Tier,Kind,Sponsor,Table,Paid");
  expect(text).toContain(`${guest.name},${guest.email},${guest.tier},Ticket,,,No\r\n`);

  const xlsxDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel" }).click();
  const xlsx = await xlsxDownload;
  expect(xlsx.suggestedFilename()).toBe("ssf-gala-reports.xlsx");
  expect((await readFile(await xlsx.path())).subarray(0, 2).toString("latin1")).toBe("PK");

  const { data: logs } = await db()
    .from("audit_logs")
    .select("action, after_data")
    .eq("actor_id", adminId)
    .eq("event_id", guest.eventId)
    .order("id");
  expect(logs).toEqual([
    { action: "report.export", after_data: { report: "roster", format: "csv", file: "roster.csv" } },
    { action: "report.export", after_data: { report: "all", format: "xlsx", file: "reports.xlsx" } },
  ]);
});
