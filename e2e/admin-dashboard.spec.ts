import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #24: admin sidebar and overview metrics. Needs a local Supabase and
// the app started with E2E_AUTH=1. Creates an active event only when none
// exists, and archives it afterwards (never deletes).
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
}

let eventId: string | undefined;

test.afterAll(async () => {
  if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
});

const SECTIONS = [
  ["Overview", "/admin"],
  ["Attendees", "/admin/attendees"],
  ["Sponsors", "/admin/sponsors"],
  ["Tables & Seating", "/admin/tables"],
  ["Payments", "/admin/payments"],
  ["Gala Setup", "/admin/setup"],
  ["Exports", "/admin/exports"],
] as const;

test("AC1: each sidebar link routes to its page", async ({ page }) => {
  await signInAs(page, "admin");
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin" });
  for (const [label, path] of SECTIONS) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("a placeholder page still checks the admin role", async ({ page }) => {
  await signInAs(page, "sponsor");
  await page.goto("/admin/payments");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByText("This section is coming soon.")).toHaveCount(0);
});

// Metric values are covered against a real database in
// src/lib/admin/overview.db.test.ts; this checks the page shows them.
test("AC2-AC4: overview shows the metrics for the active event", async ({ page }) => {
  const { data: active } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (!active?.length) {
    const { data, error } = await db()
      .from("events")
      .insert({ name: "E2E dashboard gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
      .select("id")
      .single();
    expect(error).toBeNull();
    eventId = data!.id;
  }

  await signInAs(page, "admin");
  await page.goto("/admin");
  const metric = (label: string) =>
    page.locator(".admin-metric").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(metric("Attendees")).toHaveText(/^[\d,]+$/);
  await expect(metric("Stripe collected")).toHaveText(/^\$[\d,]+\.\d\d$/);
  await expect(metric("Offline receipts")).toHaveText(/^\$[\d,]+\.\d\d$/);
  await expect(metric("Outstanding sponsorship")).toHaveText(/^\$[\d,]+\.\d\d$/);
  await expect(metric("Overbooked tables")).toHaveText(/^[\d,]+$/);
});
