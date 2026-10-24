import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { formatCents, loadOverview } from "../src/lib/admin/overview";

// QA coverage for issue #24 on top of e2e/admin-dashboard.spec.ts: every
// placeholder section keeps its server guard, and the overview shows exactly
// the numbers loadOverview computes for the active event. Needs a local
// Supabase and the app started with E2E_AUTH=1. Creates an active event only
// when none exists, and archives it afterwards (never deletes).
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function signInAs(page: Page, role: "admin" | "sponsor") {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  const { error } = await db().from("user_roles").insert({ user_id: profile!.id, role });
  expect(error).toBeNull();
}

let createdEventId: string | undefined;

async function activeEventId() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (data?.length) return data[0].id as string;
  const { data: created, error } = await db()
    .from("events")
    .insert({ name: "QA dashboard gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdEventId = created!.id;
  return createdEventId!;
}

test.afterAll(async () => {
  if (createdEventId) await db().from("events").update({ status: "archived" }).eq("id", createdEventId);
});

const PLACEHOLDERS = [
  "/admin/attendees",
  "/admin/sponsors",
  "/admin/tables",
  "/admin/payments",
  "/admin/setup",
  "/admin/exports",
];

test.describe("AC1: placeholder sections keep the admin guard", () => {
  for (const path of PLACEHOLDERS) {
    test(`signed out, ${path} goes to sign-in`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers().location).toContain(`/signin?next=${encodeURIComponent(path)}`);
    });

    test(`a sponsor at ${path} gets 403 and no sidebar`, async ({ page }) => {
      await signInAs(page, "sponsor");
      await page.goto(path);
      await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
      await expect(page.getByText("This section is coming soon.")).toHaveCount(0);
    });
  }
});

test("AC2-AC4: overview values equal loadOverview for the active event", async ({ page }) => {
  const eventId = await activeEventId();
  await signInAs(page, "admin");
  await page.goto("/admin");
  const metric = (label: string) =>
    page.locator(".admin-metric").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(metric("Attendees")).toBeVisible();

  const o = await loadOverview(db() as never, eventId);
  await expect(metric("Attendees")).toHaveText(o.attendeeCount.toLocaleString("en-US"));
  await expect(metric("Stripe collected")).toHaveText(formatCents(o.stripeCollectedCents));
  await expect(metric("Offline receipts")).toHaveText(formatCents(o.offlineReceiptsCents));
  await expect(metric("Outstanding sponsorship")).toHaveText(formatCents(o.outstandingSponsorshipCents));
  await expect(metric("Overbooked tables")).toHaveText(o.overbookedTables.toLocaleString("en-US"));
});

test.describe("screenshots", () => {
  test.skip(!process.env.QA_SHOTS, "set QA_SHOTS=<dir> to capture");
  const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ];
  for (const vp of viewports) {
    test(`capture ${vp.name}`, async ({ browser }) => {
      await activeEventId();
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await signInAs(page, "admin");
      await page.goto("/admin");
      await expect(page.locator(".admin-metric").first()).toBeVisible();
      await page.screenshot({ path: `${dir}/overview-${vp.name}.png`, fullPage: true });
      await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Tables & Seating" }).click();
      await expect(page.getByText("This section is coming soon.")).toBeVisible();
      await page.screenshot({ path: `${dir}/placeholder-tables-${vp.name}.png`, fullPage: true });
      await context.close();
    });
  }
});
