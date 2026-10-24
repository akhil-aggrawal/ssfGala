import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Gala Setup (#10): one walk through AC1-AC4 (screenshots per AC when
// QA_SHOTS_DIR is set), then the access guard and the server-side refusal.
// Needs a local Supabase and the app started with
// E2E_AUTH=1 (see auth.spec.ts).
//
// Only one gala may be draft or open, so every gala test lives in this one
// serial file: two files that each park "the" active gala race each other
// when Playwright runs files on parallel workers.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

// A random far-future four-digit year keeps this suite apart from other test data.
const year = 3000 + Math.floor(Math.random() * 6000);
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

async function signIn(page: Page, roles: string[]) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  for (const role of roles) await db().from("user_roles").insert({ user_id: profile!.id, role });
}

const SHOTS = process.env.QA_SHOTS_DIR;
const VIEWPORTS = [
  ["desktop", 1920, 1080],
  ["tablet", 1024, 768],
  ["mobile", 375, 667],
] as const;

// Full-page screenshot at each standard viewport; a no-op unless QA_SHOTS_DIR is set.
async function shoot(page: Page, shot: string) {
  if (!SHOTS) return;
  for (const [label, width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${SHOTS}/${shot}-${label}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

const newGalaForm = (page: Page) => page.getByRole("form", { name: "New gala" });
const galaForm = (page: Page, status: string) =>
  page.getByRole("form", { name: `${name} (${year}) · ${status}` });

async function fillNewGala(form: Locator, galaName: string, galaYear: number) {
  await form.getByLabel("Event name").fill(galaName);
  await form.getByLabel("Year").fill(String(galaYear));
  await form.getByLabel("Venue").fill("ICC Milpitas");
}

test.describe("AC1-AC4 through the admin UI", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ["admin"]);
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
    await shoot(page, "ac1-new-gala-saved");
  });

  test("creating a second active event shows an error and saves nothing", async ({ page }) => {
    await page.goto("/admin/setup");
    const form = newGalaForm(page);
    await fillNewGala(form, `${name} second`, year + 1);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("alert")).toHaveText(/already a draft or open gala.*Nothing was saved/);
    // A refused save keeps what the admin typed.
    await expect(form.getByLabel("Event name")).toHaveValue(`${name} second`);
    await expect(form.getByLabel("Year")).toHaveValue(String(year + 1));
    await expect(form.getByLabel("Venue")).toHaveValue("ICC Milpitas");
    const { count } = await db().from("events").select("id", { count: "exact", head: true }).eq("year", year + 1);
    expect(count).toBe(0);
    await shoot(page, "ac2-second-active-refused");
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
      if (to === "closed") {
        // A closed gala is no longer the active one.
        const { data: active } = await db().from("events").select("year").in("status", ["draft", "open"]);
        expect(active).toEqual([]);
        await shoot(page, "ac3-status-closed");
      }
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
    await archived.scrollIntoViewIfNeeded();
    await shoot(page, "ac4-archived-read-only");
  });
});

test.describe("access guard and server refusal", () => {
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
});

