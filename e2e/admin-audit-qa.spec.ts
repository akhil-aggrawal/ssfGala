import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// QA coverage for issue #22 on top of e2e/admin-audit.spec.ts: a signed-in
// user with no role is refused, the browser's keys cannot call the audit
// writer over the REST API, and the admin list renders at three viewports.
// Needs a local Supabase and the app started with E2E_AUTH=1.
test.skip(process.env.E2E_AUTH !== "1", "set E2E_AUTH=1 with a local Supabase");

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const db = () =>
  createClient(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function signIn(page: Page, roles: string[]) {
  const email = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto(`/auth/test-signin?email=${encodeURIComponent(email)}&next=/`);
  const { data: profile } = await db().from("profiles").select("id").eq("email", email).single();
  if (roles.length) {
    const { error } = await db()
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: profile!.id, role })));
    expect(error).toBeNull();
  }
  return { id: profile!.id as string, email };
}

async function activeEventId() {
  const { data } = await db().from("events").select("id").in("status", ["draft", "open"]);
  if (data?.length) return data[0].id as string;
  const { data: created, error } = await db()
    .from("events")
    .insert({ name: "QA audit gala", year: 4000 + Math.floor(Math.random() * 5000), status: "open" })
    .select("id")
    .single();
  expect(error).toBeNull();
  return created!.id as string;
}

const writerArgs = (eventId: string, actorId: string, action: string) => ({
  p_event_id: eventId,
  p_actor_id: actorId,
  p_action: action,
  p_entity_type: "qa_entity",
  p_entity_id: crypto.randomUUID(),
  p_before_data: { seats: 8 },
  p_after_data: { seats: 10 },
});

async function auditRows(action: string) {
  const { count, error } = await db()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", action);
  expect(error).toBeNull();
  return count;
}

test("AC3: a signed-in user with no role gets the 403 page", async ({ page }) => {
  await signIn(page, []);
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("AC1: the browser's anon key cannot call the audit writer", async ({ page, request }) => {
  const eventId = await activeEventId();
  const { id } = await signIn(page, []);
  const action = `qa.anon.${Math.random().toString(36).slice(2, 8)}`;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await request.post(`${url()}/rest/v1/rpc/record_audit_log`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    data: writerArgs(eventId, id, action),
  });
  expect(res.ok()).toBe(false);
  expect(await auditRows(action)).toBe(0);
});

test("AC3: admin list at desktop, tablet and mobile", async ({ page }) => {
  const eventId = await activeEventId();
  const { id } = await signIn(page, ["admin"]);
  const action = `qa.shot.${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await db().rpc("record_audit_log", writerArgs(eventId, id, action));
  expect(error).toBeNull();

  const dir = process.env.QA_SHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [name, width, height] of [
    ["desktop", 1920, 1080],
    ["tablet", 1024, 768],
    ["mobile", 375, 667],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/admin/audit");
    const row = page.getByRole("table").locator("tbody tr").filter({ hasText: action });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('{"seats":8}');
    await expect(row).toContainText('{"seats":10}');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
  }
});
