import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA pass for #10: access guard, status vs the one-active-gala rule, and
// screenshots per AC. Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const SHOTS = process.env.QA_SHOTS_DIR;
const VIEWPORTS = [
  ["desktop", 1920, 1080],
  ["tablet", 1024, 768],
  ["mobile", 375, 667],
] as const;

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const [label, width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${SHOTS}/${name}-${label}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

const year = 3000 + Math.floor(Math.random() * 5000);
const name = `QA setup gala ${year}`;
let parked: { id: string; status: string } | null = null;

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
});

test.afterAll(async () => {
  await db().from("events").update({ status: "archived" }).in("year", [year, year + 1]);
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

async function signIn(page: Page, roles: string[]) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  for (const role of roles) await db().from("user_roles").insert({ user_id: profile!.id, role });
}

const galaForm = (page: Page, title: string) => page.getByRole("form", { name: title });

test("a signed-out visitor to /admin/setup is sent to sign-in", async ({ page }) => {
  await page.goto("/admin/setup");
  await expect(page).toHaveURL(/\/signin\?next=%2Fadmin%2Fsetup$/);
});

test("a signed-in non-admin gets the 403 page at /admin/setup and sees no gala form", async ({ page }) => {
  await signIn(page, ["sponsor"]);
  await page.goto("/admin/setup");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("form", { name: "New gala" })).toHaveCount(0);
});

test("AC1 + AC2 + AC3 + AC4 through the admin UI", async ({ page }) => {
  await signIn(page, ["admin"]);
  await page.goto("/admin/setup");

  // AC1: defaults and exactly three tiers.
  const fresh = galaForm(page, "New gala");
  await expect(fresh.getByLabel("Silver seat price")).toHaveValue("150");
  await expect(fresh.getByLabel("Gold seat price")).toHaveValue("200");
  await expect(fresh.getByLabel("Platinum seat price")).toHaveValue("250");
  await fresh.getByLabel("Event name").fill(name);
  await fresh.getByLabel("Year").fill(String(year));
  await fresh.getByRole("button", { name: "Save" }).click();
  await expect(galaForm(page, `${name} (${year}) · draft`)).toBeVisible();
  const { data: created } = await db()
    .from("events")
    .select("id, seating_tiers (name, seat_price_cents)")
    .eq("year", year)
    .single();
  expect(created!.seating_tiers).toHaveLength(3);
  await shoot(page, "ac1-new-gala-saved");

  // AC2: a second draft gala is refused and nothing is saved.
  await fresh.getByLabel("Event name").fill(`${name} second`);
  await fresh.getByLabel("Year").fill(String(year + 1));
  await fresh.getByRole("button", { name: "Save" }).click();
  await expect(fresh.getByRole("alert")).toHaveText(/already a draft or open gala.*Nothing was saved/);
  const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("year", year + 1);
  expect(count).toBe(0);
  await shoot(page, "ac2-second-active-refused");

  // AC3: open, then closed; once closed it is no longer the active gala,
  // so a new draft gala can be created.
  for (const [from, to] of [["draft", "open"], ["open", "closed"]]) {
    const form = galaForm(page, `${name} (${year}) · ${from}`);
    await form.getByLabel("Status").selectOption(to);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(galaForm(page, `${name} (${year}) · ${to}`)).toBeVisible();
  }
  const { data: active } = await db().from("events").select("year").in("status", ["draft", "open"]);
  expect(active).toEqual([]);
  await shoot(page, "ac3-status-closed");

  // AC4: archive it; it is listed with every field disabled and no Save.
  const closed = galaForm(page, `${name} (${year}) · closed`);
  await closed.getByLabel("Status").selectOption("archived");
  await closed.getByRole("button", { name: "Save" }).click();
  const archived = page
    .getByRole("region", { name: "Archived galas" })
    .getByRole("form", { name: `${name} (${year}) · archived` });
  await expect(archived).toBeVisible();
  for (const field of await archived.locator("input:not([type=hidden]), select").all()) {
    await expect(field).toBeDisabled();
  }
  await expect(archived.getByRole("button", { name: "Save" })).toHaveCount(0);
  await archived.scrollIntoViewIfNeeded();
  await shoot(page, "ac4-archived-read-only");
});

test("a forged save on an archived gala is refused by the server", async () => {
  const { data } = await db().from("events").select("id").eq("year", year).single();
  const { error } = await db().rpc("save_gala_setup", {
    p_actor_id: null as unknown as string,
    p_event: { name: "Changed", year, status: "open" },
    p_tiers: [
      { name: "Silver", seat_price_cents: 1, suggested_contribution_cents: 1, sponsorship_amount_cents: null, table_inventory: 0 },
      { name: "Gold", seat_price_cents: 1, suggested_contribution_cents: 1, sponsorship_amount_cents: null, table_inventory: 0 },
      { name: "Platinum", seat_price_cents: 1, suggested_contribution_cents: 1, sponsorship_amount_cents: null, table_inventory: 0 },
    ],
    p_event_id: data!.id,
  });
  expect(error?.code).toBe("55000");
  const { data: after } = await db().from("events").select("name, status").eq("id", data!.id).single();
  expect(after).toEqual({ name, status: "archived" });
});
