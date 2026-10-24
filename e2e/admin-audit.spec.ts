import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// Issue #22 AC3. Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signInWithRoles(page: Page, roles: string[]) {
  const email = uniqueEmail();
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const db = admin();
  const { data: profile } = await db.from("profiles").select("id").eq("email", email).single();
  if (roles.length) {
    const { error } = await db
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: profile!.id, role })));
    expect(error).toBeNull();
  }
  return profile!.id as string;
}

// The one active gala, created when the local DB has none.
async function activeEventId() {
  const db = admin();
  const find = () => db.from("events").select("id").in("status", ["draft", "open"]).maybeSingle();
  let { data } = await find();
  if (!data) {
    await db.from("events").insert({ name: "E2E Gala", year: 2090, status: "open" });
    ({ data } = await find());
  }
  return data!.id as string;
}

async function archivedEventId() {
  const db = admin();
  await db.from("events").upsert(
    { name: "E2E Past Gala", year: 2089, status: "archived" },
    { onConflict: "year", ignoreDuplicates: true },
  );
  const { data } = await db.from("events").select("id").eq("year", 2089).single();
  return data!.id as string;
}

async function writeAudit(eventId: string, actorId: string, action: string) {
  const { error } = await admin().rpc("record_audit_log", {
    p_event_id: eventId,
    p_actor_id: actorId,
    p_action: action,
    p_entity_type: "e2e_entity",
    p_entity_id: crypto.randomUUID(),
    p_before_data: { n: 0 },
    p_after_data: { n: 1 },
  });
  expect(error).toBeNull();
}

test("a signed-out request to /admin/audit redirects to sign-in", async ({ page }) => {
  const res = await page.request.get("/admin/audit", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/signin\?next=%2Fadmin%2Faudit$/);
});

test("a sponsor gets the 403 page at /admin/audit", async ({ page }) => {
  await signInWithRoles(page, ["sponsor"]);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("an admin sees the newest 100 entries for the active event only", async ({ page }) => {
  const actorId = await signInWithRoles(page, ["admin"]);
  const eventId = await activeEventId();
  const run = Math.random().toString(36).slice(2, 8);

  await writeAudit(await archivedEventId(), actorId, `e2e.${run}.other-event`);
  for (let i = 0; i <= 100; i++) await writeAudit(eventId, actorId, `e2e.${run}.${i}`);

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(100);
  await expect(rows.first()).toContainText(`e2e.${run}.100`);
  await expect(rows.first()).toContainText('{"n":0}');
  await expect(rows.first()).toContainText('{"n":1}');
  await expect(page.getByText(`e2e.${run}.0`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`e2e.${run}.other-event`)).toHaveCount(0);
});
