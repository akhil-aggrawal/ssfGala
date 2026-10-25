import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #23 QA: sponsors edit guests and remove only unpaid guests, end to
// end through /sponsor/dashboard, plus the direct calls a browser could make
// (PostgREST RPC with the sponsor's own token, a tampered Server Action form).
// Needs a local Supabase and the app started with E2E_AUTH=1.
// SHOTS_DIR=<dir> also saves screenshots of the guest list.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");
test.describe.configure({ mode: "serial" });

const env = (name: string) => process.env[name] ?? "";
const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const db = () =>
  createClient(SUPABASE_URL, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

let eventId = "";

const activeEvent = async () =>
  (
    await db()
      .from("events")
      .select("id")
      .in("status", ["draft", "open"])
      .maybeSingle()
  ).data?.id as string | undefined;

test.beforeAll(async () => {
  eventId = (await activeEvent()) ?? "";
  if (!eventId) {
    await db()
      .from("events")
      .insert({
        name: "QA guest edits gala",
        year: 4000 + Math.floor(Math.random() * 5000),
        status: "open",
      });
    eventId = (await activeEvent()) ?? "";
  }
  expect(eventId).not.toBe("");
});

async function one(table: string, row: object): Promise<{ id: string }> {
  const { data, error } = await db()
    .from(table)
    .insert(row)
    .select("id")
    .single();
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return data as { id: string };
}

async function tierId(name: string) {
  await db()
    .from("seating_tiers")
    .upsert(
      [
        {
          event_id: eventId,
          name,
          seat_price_cents: 20000,
          suggested_contribution_cents: 20000,
        },
      ],
      {
        onConflict: "event_id,name",
        ignoreDuplicates: true,
      },
    );
  const { data } = await db()
    .from("seating_tiers")
    .select("id")
    .eq("event_id", eventId)
    .eq("name", name)
    .single();
  return data!.id as string;
}

async function signIn(page: Page, label: string) {
  const email = `qa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(
    `/auth/test-signin?email=${encodeURIComponent(email)}&next=/`,
  );
  const { data: profile } = await db()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  return profile!.id as string;
}

// One committed table for `userId` with the named guests; `paid` guests get a
// succeeded payment allocation. Returns guest ids by name.
async function table(userId: string, guests: string[], paid: string[] = []) {
  const tid = await tierId("Gold");
  const sponsor = await one("sponsors", {
    event_id: eventId,
    user_id: userId,
    display_name: "QA",
    email: "s@example.test",
  });
  const sp = await one("sponsorships", {
    event_id: eventId,
    sponsor_id: sponsor.id,
    pledged_cents: 0,
  });
  const st = await one("sponsored_tables", {
    event_id: eventId,
    sponsorship_id: sp.id,
    tier_id: tid,
    invite_token_hash: randomUUID(),
  });
  const reg = await one("registrations", {
    event_id: eventId,
    kind: "sponsored",
    tier_id: tid,
    sponsored_table_id: st.id,
  });
  const ids: Record<string, string> = {};
  for (const name of guests) {
    const email = `${name.split(" ")[0].toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`;
    ids[name] = (
      await one("attendees", {
        event_id: eventId,
        registration_id: reg.id,
        full_name: name,
        email,
      })
    ).id;
  }
  for (const name of paid) {
    const pay = await one("payments", {
      event_id: eventId,
      registration_id: reg.id,
      provider: "stripe",
      purpose: "seat_contribution",
      amount_cents: 5000,
      status: "succeeded",
    });
    await one("payment_allocations", {
      event_id: eventId,
      payment_id: pay.id,
      attendee_id: ids[name],
      amount_cents: 5000,
    });
  }
  return ids;
}

const card = (page: Page) =>
  page
    .getByRole("list", { name: "Your tables" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("article") })
    .first();
const row = (page: Page, name: string) =>
  page.locator("li.guest-row").filter({ hasText: name });

async function openGuests(page: Page) {
  await page.goto("/sponsor/dashboard");
  await card(page).getByText("View guests").click();
}

async function shot(page: Page, file: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  for (const [vp, size] of [
    ["desktop", { width: 1920, height: 1080 }],
    ["tablet", { width: 1024, height: 768 }],
    ["mobile", { width: 375, height: 667 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.screenshot({ path: `${dir}/${file}-${vp}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

// The sponsor's own access token, read from the @supabase/ssr session cookie.
async function accessToken(page: Page): Promise<string> {
  const parts = (await page.context().cookies())
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let raw = parts.map((c) => decodeURIComponent(c.value)).join("");
  if (raw.startsWith("base64-"))
    raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = (JSON.parse(raw) as { access_token: string }).access_token;
  expect(token).toBeTruthy();
  return token;
}

const audit = async (attendeeId: string) =>
  (
    await db()
      .from("audit_logs")
      .select("action, actor_id, before_data, after_data")
      .eq("entity_id", attendeeId)
      .order("created_at")
  ).data ?? [];

test("AC1 + AC4: removing an unpaid guest soft-cancels them, drops the count and writes an audit row", async ({
  page,
}) => {
  const me = await signIn(page, "ge-remove");
  const ids = await table(me, ["Una Unpaid", "Pia Paid"], ["Pia Paid"]);

  await openGuests(page);
  await expect(card(page).locator(".sponsor-dash__count")).toHaveText(
    "2 registered / 10 capacity",
  );
  await shot(page, "ac1-before-remove");

  page.once("dialog", (d) => d.accept());
  await row(page, "Una Unpaid")
    .getByRole("button", { name: "Remove Una Unpaid" })
    .click();
  await expect(card(page).locator(".sponsor-dash__count")).toHaveText(
    "1 registered / 10 capacity",
  );

  await openGuests(page);
  await expect(card(page).locator(".sponsor-dash__count")).toHaveText(
    "1 registered / 10 capacity",
  );
  await expect(page.locator("body")).not.toContainText("Una Unpaid");
  await shot(page, "ac1-after-remove");

  const { data: guest } = await db()
    .from("attendees")
    .select("cancelled_at")
    .eq("id", ids["Una Unpaid"])
    .single();
  expect(guest!.cancelled_at).not.toBeNull();
  const rows = await audit(ids["Una Unpaid"]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "attendee.cancel",
    actor_id: me,
    before_data: { full_name: "Una Unpaid", cancelled_at: null },
    after_data: { full_name: "Una Unpaid" },
  });
  expect(
    (rows[0].after_data as { cancelled_at: string | null }).cancelled_at,
  ).not.toBeNull();
});

test("AC2: a paid guest's Remove is disabled with the reason, and a direct API call is refused", async ({
  page,
}) => {
  const me = await signIn(page, "ge-paid");
  const ids = await table(me, ["Paz Paid"], ["Paz Paid"]);

  await openGuests(page);
  const remove = row(page, "Paz Paid").getByRole("button", {
    name: "Remove Paz Paid",
  });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription(
    /has paid, so they can't be removed/,
  );
  await expect(row(page, "Paz Paid")).toContainText(
    "This guest has paid, so they can't be removed.",
  );
  await shot(page, "ac2-paid-disabled");

  // The sponsor's own browser token calling the function over PostgREST.
  const token = await accessToken(page);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sponsor_remove_guest`, {
    method: "POST",
    headers: {
      apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: me,
      p_event_id: eventId,
      p_attendee_id: ids["Paz Paid"],
    }),
  });
  expect(res.ok).toBe(false);
  expect([401, 403, 404]).toContain(res.status);

  // The Server Action, posted with the disabled button re-enabled.
  await remove.evaluate((b) => b.removeAttribute("disabled"));
  page.once("dialog", (d) => d.accept());
  await remove.click();
  await expect(row(page, "Paz Paid").getByRole("status")).toContainText(
    "has paid",
  );

  const { data: guest } = await db()
    .from("attendees")
    .select("cancelled_at")
    .eq("id", ids["Paz Paid"])
    .single();
  expect(guest!.cancelled_at).toBeNull();
  expect(await audit(ids["Paz Paid"])).toHaveLength(0);
});

test("AC3: a tampered form cannot edit or remove another sponsor's guest", async ({
  page,
}) => {
  const other = await signIn(page, "ge-other");
  const theirs = await table(other, ["Otis Other"]);
  await page.context().clearCookies();

  const me = await signIn(page, "ge-mine");
  await table(me, ["Mo Mine"]);
  await openGuests(page);
  await expect(page.locator("body")).not.toContainText("Otis Other");

  const mine = row(page, "Mo Mine");
  await mine
    .locator('input[name="id"]')
    .evaluateAll(
      (els, id) => els.forEach((e) => ((e as HTMLInputElement).value = id)),
      theirs["Otis Other"],
    );

  await mine.getByText("Edit guest").click();
  await mine.getByLabel("Name").fill("Hacked Name");
  await mine.getByRole("button", { name: "Save" }).click();
  await expect(mine.getByRole("status")).toHaveText(
    "That guest is no longer on your table. Nothing was saved.",
  );

  page.once("dialog", (d) => d.accept());
  await mine.getByRole("button", { name: "Remove Mo Mine" }).click();
  await expect(mine.getByRole("status")).toHaveText(
    "That guest is no longer on your table. Nothing was saved.",
  );
  await shot(page, "ac3-other-sponsor-refused");

  const { data: guest } = await db()
    .from("attendees")
    .select("full_name, cancelled_at")
    .eq("id", theirs["Otis Other"])
    .single();
  expect(guest).toEqual({ full_name: "Otis Other", cancelled_at: null });
  expect(await audit(theirs["Otis Other"])).toHaveLength(0);
});

test("AC4: editing a guest saves name and email and writes an audit row with before and after", async ({
  page,
}) => {
  const me = await signIn(page, "ge-edit");
  const ids = await table(me, ["Eve Edit"], ["Eve Edit"]);
  const { data: before } = await db()
    .from("attendees")
    .select("email")
    .eq("id", ids["Eve Edit"])
    .single();

  await openGuests(page);
  const r = row(page, "Eve Edit");
  await r.getByText("Edit guest").click();
  await r.getByLabel("Name").fill("Eve Edited");
  await r.getByLabel("Email").fill("eve.edited@example.test");
  await r.getByRole("button", { name: "Save" }).click();
  await expect(r.getByRole("status")).toHaveText("Saved.");
  await shot(page, "ac4-edit-saved");

  await openGuests(page);
  await expect(row(page, "Eve Edited")).toContainText(
    "eve.edited@example.test",
  );

  const rows = await audit(ids["Eve Edit"]);
  expect(rows).toEqual([
    {
      action: "attendee.update",
      actor_id: me,
      before_data: { full_name: "Eve Edit", email: before!.email },
      after_data: { full_name: "Eve Edited", email: "eve.edited@example.test" },
    },
  ]);
});
