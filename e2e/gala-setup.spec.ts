import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Needs a local Supabase and the app started with E2E_AUTH=1 (see auth.spec.ts).
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// Random far-future years keep this suite apart from other test data.
const year = 3000 + Math.floor(Math.random() * 5000);
const name = `E2E setup gala ${year}`;
// Only one gala may be draft or open: park any existing one and restore it after.
let parked: { id: string; status: string } | null = null;

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
});

test.afterAll(async () => {
  await db().from("events").update({ status: "archived" }).eq("year", year);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

async function signInAsAdmin(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  await db().from("user_roles").insert({ user_id: profile!.id, role: "admin" });
}

const newGalaForm = (page: Page) => page.getByRole("form", { name: "New gala" });
const galaForm = (page: Page, status: string) =>
  page.getByRole("form", { name: `${name} (${year}) · ${status}` });

async function fillNewGala(form: Locator, galaName: string, galaYear: number) {
  await form.getByLabel("Event name").fill(galaName);
  await form.getByLabel("Year").fill(String(galaYear));
  await form.getByLabel("Venue").fill("ICC Milpitas");
}

test.beforeEach(async ({ page }) => {
  await signInAsAdmin(page);
});

test("the admin home links to Gala Setup", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Gala Setup" }).click();
  await expect(page.getByRole("heading", { name: "Gala Setup", level: 1 })).toBeVisible();
});

test("saving a new event creates exactly three tiers at $150, $200 and $250", async ({ page }) => {
  await page.goto("/admin/setup");
  const form = newGalaForm(page);
  await expect(form.getByLabel("Silver seat price")).toHaveValue("150");
  await expect(form.getByLabel("Gold seat price")).toHaveValue("200");
  await expect(form.getByLabel("Platinum seat price")).toHaveValue("250");
  await fillNewGala(form, name, year);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(galaForm(page, "draft")).toBeVisible();

  const { data } = await db()
    .from("events")
    .select("status, seating_tiers (name, seat_price_cents)")
    .eq("year", year)
    .single();
  expect(data!.status).toBe("draft");
  expect(data!.seating_tiers.map((t) => [t.name, t.seat_price_cents]).sort()).toEqual([
    ["Gold", 20000],
    ["Platinum", 25000],
    ["Silver", 15000],
  ]);
});

test("creating a second active event shows an error and saves nothing", async ({ page }) => {
  await page.goto("/admin/setup");
  const form = newGalaForm(page);
  await fillNewGala(form, `${name} second`, year + 1);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveText(/already a draft or open gala.*Nothing was saved/);
  const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("year", year + 1);
  expect(count).toBe(0);
});

test("the status control saves open and closed", async ({ page }) => {
  await page.goto("/admin/setup");
  for (const [from, to] of [["draft", "open"], ["open", "closed"], ["closed", "draft"]]) {
    const form = galaForm(page, from);
    await form.getByLabel("Status").selectOption(to);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(galaForm(page, to)).toBeVisible();
    const { data } = await db().from("events").select("status").eq("year", year).single();
    expect(data!.status).toBe(to);
  }
});

test("an archived event is listed with every field read-only", async ({ page }) => {
  await page.goto("/admin/setup");
  const form = galaForm(page, "draft");
  await form.getByLabel("Status").selectOption("archived");
  await form.getByRole("button", { name: "Save" }).click();

  const archived = page.getByRole("region", { name: "Archived galas" }).getByRole("form", {
    name: `${name} (${year}) · archived`,
  });
  await expect(archived).toBeVisible();
  await expect(archived.getByText("Archived galas are read-only.")).toBeVisible();
  for (const field of await archived.locator("input:not([type=hidden]), select").all()) {
    await expect(field).toBeDisabled();
  }
  await expect(archived.getByRole("button", { name: "Save" })).toHaveCount(0);
});
