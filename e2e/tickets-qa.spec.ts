import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #11 on top of e2e/tickets.spec.ts: a `closed` gala
// and no gala at all, a sale that closes before Continue, choices tampered
// in the URL, the real sign-in form carrying the choice, and accessibility.
// Needs a local Supabase and the app started with E2E_AUTH=1. Run with
// --workers=1: like tickets.spec.ts it parks the active gala.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const year = 3000 + Math.floor(Math.random() * 6000);
const PRICES = { Silver: 16000, Gold: 21000, Platinum: 26000 };
let eventId = "";
let parked: { id: string; status: string } | null = null;

const setStatus = async (status: string) => {
  const { error } = await db().from("events").update({ status }).eq("id", eventId);
  if (error) throw error;
};

test.beforeAll(async () => {
  const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
  parked = data;
  if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
  const { data: event, error } = await db()
    .from("events")
    .insert({ name: `QA tickets gala ${year}`, year, status: "open" })
    .select("id")
    .single();
  if (error) throw error;
  eventId = event.id;
  const tiers = Object.entries(PRICES).map(([name, cents]) => ({
    event_id: eventId,
    name,
    seat_price_cents: cents,
    suggested_contribution_cents: cents,
  }));
  const { error: tierError } = await db().from("seating_tiers").insert(tiers);
  if (tierError) throw tierError;
});

test.afterAll(async () => {
  if (eventId) await setStatus("archived");
  if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
});

const form = (page: Page) => page.getByRole("form", { name: "Choose tickets" });
const total = (page: Page) => page.getByText(/^Total:/);
const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

test.describe("AC4: every not-open state shows the closed message", () => {
  test("a closed gala shows the closed message and no Continue", async ({ page }) => {
    await setStatus("closed");
    try {
      await page.goto("/tickets");
      await expect(page.getByRole("status")).toHaveText(/Ticket sales are closed/);
      await expect(continueButton(page)).toHaveCount(0);
      await expect(page.getByText("$210 per seat")).toHaveCount(0);
    } finally {
      await setStatus("open");
    }
  });

  test("no active gala at all shows the closed message, not an error", async ({ page }) => {
    await setStatus("archived");
    try {
      const res = await page.goto("/tickets");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("status")).toHaveText(/Ticket sales are closed/);
      await expect(continueButton(page)).toHaveCount(0);
    } finally {
      await setStatus("open");
    }
  });

  test("a sale that closes before Continue sends the buyer back to the closed page", async ({ page }) => {
    await page.goto("/tickets");
    await form(page).getByRole("radio", { name: /Gold/ }).check();
    await setStatus("closed");
    try {
      await continueButton(page).click();
      await expect(page).toHaveURL(/\/tickets$/);
      await expect(page.getByRole("status")).toHaveText(/Ticket sales are closed/);
    } finally {
      await setStatus("open");
    }
  });
});

test.describe("AC2/AC3: the choice in the URL is checked, not trusted", () => {
  for (const [query, label] of [
    ["tier=Diamond&quantity=3", "an unknown tier"],
    ["tier=gold&quantity=2", "a tier in the wrong case"],
  ] as const) {
    test(`${label} pre-selects nothing`, async ({ page }) => {
      await page.goto(`/tickets?${query}`);
      for (const radio of await form(page).getByRole("radio").all()) await expect(radio).not.toBeChecked();
      await expect(total(page)).toHaveText("Total: choose a tier");
    });
  }

  for (const quantity of ["0", "11", "99", "-1", "2.5", "abc"]) {
    test(`quantity=${quantity} falls back to 1`, async ({ page }) => {
      await page.goto(`/tickets?tier=Gold&quantity=${quantity}`);
      await expect(form(page).getByLabel("Quantity")).toHaveValue("1");
      await expect(total(page)).toHaveText("Total: $210");
    });
  }

  test("quantity=10, a full table, is kept", async ({ page }) => {
    await page.goto("/tickets?tier=Platinum&quantity=10");
    await expect(form(page).getByLabel("Quantity")).toHaveValue("10");
    await expect(total(page)).toHaveText("Total: $2,600");
  });

  test("Continue without a tier stays on /tickets", async ({ page }) => {
    await page.goto("/tickets");
    await continueButton(page).click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(total(page)).toHaveText("Total: choose a tier");
  });
});

test("AC3: the real sign-in form posts the choice as next", async ({ page }) => {
  await page.goto("/tickets");
  await form(page).getByRole("radio", { name: /Platinum/ }).check();
  await form(page).getByLabel("Quantity").selectOption("4");
  await expect(total(page)).toHaveText("Total: $1,040");
  await continueButton(page).click();
  await expect(page).toHaveURL(/\/signin\?next=/);
  await expect(page.locator('form input[name="next"]')).toHaveValue("/tickets?tier=Platinum&quantity=4");
});

test.describe("accessibility", () => {
  for (const vp of [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "mobile", width: 375, height: 667 },
  ]) {
    test(`/tickets has no axe violations and no sideways scroll at ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await page.goto("/tickets?tier=Gold&quantity=2");
      await expect(total(page)).toHaveText("Total: $420");
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await context.close();
    });
  }
});

// Evidence screenshots for the QA report; off unless QA_SHOTS is set.
test.describe("screenshots", () => {
  test.skip(!process.env.QA_SHOTS, "set QA_SHOTS=<dir> to capture");
  const viewports = [
    { name: "desktop", width: 1920, height: 1080 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "mobile", width: 375, height: 667 },
  ];
  for (const vp of viewports) {
    test(`capture ${vp.name}`, async ({ browser }) => {
      const dir = process.env.QA_SHOTS!;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();

      await page.goto("/tickets");
      await expect(form(page).getByText("$160 per seat")).toBeVisible();
      await page.screenshot({ path: `${dir}/ac1-tiers-from-db-${vp.name}.png`, fullPage: true });

      await form(page).getByRole("radio", { name: /Gold/ }).check();
      await form(page).getByLabel("Quantity").selectOption("3");
      await expect(total(page)).toHaveText("Total: $630");
      await page.screenshot({ path: `${dir}/ac2-total-${vp.name}.png`, fullPage: true });

      await continueButton(page).click();
      await expect(page).toHaveURL(/\/signin\?next=/);
      await page.goto(`/tickets?tier=Gold&quantity=3`);
      await expect(form(page).getByLabel("Quantity")).toHaveValue("3");
      await page.screenshot({ path: `${dir}/ac3-choice-kept-${vp.name}.png`, fullPage: true });

      await setStatus("closed");
      try {
        await page.goto("/tickets");
        await expect(page.getByRole("status")).toBeVisible();
        await page.screenshot({ path: `${dir}/ac4-closed-${vp.name}.png`, fullPage: true });
      } finally {
        await setStatus("open");
      }
      await context.close();
    });
  }
});
