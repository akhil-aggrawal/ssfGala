import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";

// QA for issue #35: the real Send table assignments and cancel Server Actions
// against a real local Supabase (`supabase start`), emails kept in the memory
// outbox. Only the role guard and revalidatePath are stubbed, so loadSeating,
// loadGalaEvent, the cancel RPC and the attendee + event join in
// notifyCancellation all meet the real schema.
// Off by default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. It parks the
// open gala for its run and puts it back; its own gala is archived
// afterwards. Nothing is deleted.
const enabled = process.env.DB_TESTS === "1";

const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/auth/guard", () => guard);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const FROM = "SSF Gala <onboarding@resend.dev>";
const GALA = "QA Seating Notices Gala";

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = (name: string) => `qa35-${name.toLowerCase()}-${tag()}@example.test`;

async function one<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error) throw error;
  return data!;
}

describe.skipIf(!enabled)("table assignment and cancellation notices against the real schema (issue #35 QA)", () => {
  let outbox: { to: string; from: string; subject: string; text: string; html: string; idempotencyKey: string }[];
  let tables: typeof import("@/app/admin/tables/actions");
  let attendees: typeof import("@/app/admin/attendees/actions");
  let parked: { id: string; status: string } | null = null;
  let eventId = "";
  let adminId = "";
  // name -> { id, email }
  const people: Record<string, { id: string; email: string }> = {};

  beforeAll(async () => {
    outbox = (await import("./transport")).outbox;
    tables = await import("@/app/admin/tables/actions");
    attendees = await import("@/app/admin/attendees/actions");

    parked = (await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle()).data;
    if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
    const event = await one(
      db()
        .from("events")
        .insert({
          name: GALA,
          year: 20000 + Math.floor(Math.random() * 1e6),
          status: "open",
          date_at: "2027-01-24T02:00:00Z",
          venue: "ICC Milpitas",
        })
        .select("id")
        .single(),
    );
    eventId = event.id;

    const adminEmail = email("admin");
    const { data: u, error: uErr } = await db().auth.admin.createUser({ email: adminEmail, email_confirm: true });
    if (uErr) throw uErr;
    adminId = u.user.id;
    await one(db().from("profiles").insert({ id: adminId, email: adminEmail, display_name: "QA Admin" }).select("id").single());

    const tier = await one(
      db()
        .from("seating_tiers")
        .insert({ event_id: eventId, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 })
        .select("id")
        .single(),
    );
    const sponsor = await one(
      db().from("sponsors").insert({ event_id: eventId, display_name: "QA Sponsor", email: email("sponsor") }).select("id").single(),
    );
    const ship = await one(
      db()
        .from("sponsorships")
        .insert({ event_id: eventId, sponsor_id: sponsor.id, pledged_cents: 200000, status: "committed" })
        .select("id")
        .single(),
    );
    const table = await one(
      db()
        .from("sponsored_tables")
        .insert({
          event_id: eventId,
          sponsorship_id: ship.id,
          tier_id: tier.id,
          invite_token_hash: `qa35-${tag()}`,
          capacity: 10,
          physical_table_number: "12",
        })
        .select("id")
        .single(),
    );

    const registration = (fields: Partial<Database["public"]["Tables"]["registrations"]["Insert"]>) =>
      one(
        db()
          .from("registrations")
          .insert({ event_id: eventId, tier_id: tier.id, kind: "complimentary", ...fields })
          .select("id")
          .single(),
      );
    const sponsored = await registration({ kind: "sponsored", sponsored_table_id: table.id });
    const comp = await registration({});
    const cancelledReg = await registration({ status: "cancelled" });

    const seed: [string, string, string | null, string | null][] = [
      // name, registration, assigned table number, cancelled_at
      ["Asha", sponsored.id, null, null], // sits at the sponsored table: 12
      ["Ravi", sponsored.id, "VIP-1", null], // moved
      ["Cara", sponsored.id, null, "2026-10-01T00:00:00Z"], // cancelled guest
      ["Dev", comp.id, null, null], // no table number
      ["Eli", comp.id, "7", null],
      ["Fay", cancelledReg.id, "9", null], // cancelled registration
    ];
    for (const [name, registration_id, assigned_table_number, cancelled_at] of seed) {
      const addr = email(name);
      const row = await one(
        db()
          .from("attendees")
          .insert({ event_id: eventId, registration_id, full_name: `${name} QA`, email: addr, assigned_table_number, cancelled_at })
          .select("id")
          .single(),
      );
      people[name] = { id: row.id, email: addr };
    }
  });

  afterAll(async () => {
    if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
    if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
  });

  beforeEach(() => {
    vi.stubEnv("EMAIL_FROM", FROM);
    vi.stubEnv("EMAIL_TRANSPORT", "memory");
    guard.requireRole.mockReset().mockResolvedValue({ user: { id: adminId }, eventId });
    outbox.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const tableOf = (to: string) => outbox.find((m) => m.to === to)?.text.match(/Table (\S+)/)?.[1];

  it("AC1 + AC2: emails each active guest with a table number their own table, skips and counts the rest", async () => {
    const result = await tables.sendTableAssignments();

    expect(result).toEqual({ ok: true, message: "Sent 3 table assignments. Skipped 1 guest without a table number." });
    expect(outbox.map((m) => m.to).sort()).toEqual([people.Asha.email, people.Ravi.email, people.Eli.email].sort());
    expect(tableOf(people.Asha.email)).toBe("12");
    expect(tableOf(people.Ravi.email)).toBe("VIP-1");
    expect(tableOf(people.Eli.email)).toBe("7");
    for (const m of outbox) {
      expect(m.from).toBe(FROM);
      expect(m.subject).toBe(`Your table for ${GALA}`);
      expect(m.text).toContain("ICC Milpitas");
      expect(`${m.text} ${m.html}`).not.toMatch(/overbook|capacity/i);
    }
  });

  it("AC1: a repeat click reuses each guest's key, so Resend sends it once; a moved guest gets a new key", async () => {
    await tables.sendTableAssignments();
    const first = outbox.map((m) => m.idempotencyKey).sort();
    outbox.length = 0;
    await tables.sendTableAssignments();
    expect(outbox.map((m) => m.idempotencyKey).sort()).toEqual(first);
    expect(new Set(first).size).toBe(3);

    await db().from("attendees").update({ assigned_table_number: "15" }).eq("id", people.Asha.id);
    outbox.length = 0;
    await tables.sendTableAssignments();
    const asha = outbox.find((m) => m.to === people.Asha.email)!;
    expect(asha.idempotencyKey).toBe(`table-assignment:${people.Asha.id}:15`);
    expect(tableOf(people.Asha.email)).toBe("15");
  });

  it("AC3: cancelling an attendee sends them one cancellation notice; a second cancel sends nothing", async () => {
    const fd = new FormData();
    fd.set("attendee_id", people.Dev.id);

    await expect(attendees.cancelAttendee(null, fd)).resolves.toEqual({ ok: true, message: "Cancelled." });
    expect(outbox).toHaveLength(1);
    const [m] = outbox;
    expect(m.to).toBe(people.Dev.email);
    expect(m.idempotencyKey).toBe(`attendee-cancellation:${people.Dev.id}`);
    expect(m.subject).toBe(`Your registration for ${GALA} is cancelled`);
    expect(m.text).toContain("Dev QA");

    const again = await attendees.cancelAttendee(null, fd);
    expect(again?.ok).toBe(false);
    expect(outbox).toHaveLength(1);

    // The cancelled guest drops out of the next table send.
    outbox.length = 0;
    const result = await tables.sendTableAssignments();
    expect(result?.message).toBe("Sent 3 table assignments. Skipped 0 guests without a table number.");
  });

  it("AC3: a cancel in another gala sends no notice", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: adminId }, eventId: parked?.id ?? crypto.randomUUID() });
    const fd = new FormData();
    fd.set("attendee_id", people.Eli.id);
    const result = await attendees.cancelAttendee(null, fd);
    expect(result?.ok).toBe(false);
    expect(outbox).toHaveLength(0);
  });
});
