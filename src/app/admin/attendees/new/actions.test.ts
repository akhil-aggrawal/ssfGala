import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action is reachable by a direct POST, so its own admin check (not
// the page guard) is what stops a non-admin from adding attendees.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { addAttendees } = await import("./actions");

const TIER = "00000000-0000-0000-0000-0000000000f1";
const EVENT = "00000000-0000-0000-0000-00000000e001";

function attendeeForm(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ kind: "complimentary", tier_id: TIER, amount: "", ...fields })) fd.set(k, v);
  fd.append("attendee_name", "Asha Rao");
  fd.append("attendee_email", "asha@example.test");
  return fd;
}

describe("addAttendees", () => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    rpc.mockReset().mockResolvedValue({ data: "reg-1", error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(addAttendees(null, attendeeForm())).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/attendees/new");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes the write to the active gala, never a posted event id", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: EVENT });
    const fd = attendeeForm({ kind: "offline_paid", amount: "400", event_id: "11111111-1111-1111-1111-111111111111" });
    await expect(addAttendees(null, fd)).resolves.toEqual({ ok: true, message: "Added 1 attendee." });
    expect(rpc).toHaveBeenCalledWith("add_admin_attendees", {
      p_actor_id: "admin-1",
      p_event_id: EVENT,
      p_kind: "offline_paid",
      p_tier_id: TIER,
      p_attendees: [{ full_name: "Asha Rao", email: "asha@example.test" }],
      p_amount_cents: 40000,
    });
  });

  it("sends no amount for a complimentary registration", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: EVENT });
    await addAttendees(null, attendeeForm({ amount: "50" }));
    expect(rpc.mock.calls[0][1].p_amount_cents).toBeUndefined();
  });

  it("refuses when no gala is active", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: null });
    await expect(addAttendees(null, attendeeForm())).resolves.toEqual({
      ok: false,
      message: "No active gala is set up yet. Nothing was saved.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns plain words when the database refuses", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: EVENT });
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "admin_attendees_archived" } });
    const result = await addAttendees(null, attendeeForm());
    expect(result).toMatchObject({ ok: false });
    expect(result?.message).toMatch(/archived/);
  });
});

// AC3: admins must never charge a card. Nothing under the attendees area may
// import or call Stripe.
describe("admin attendees area", () => {
  const root = join(process.cwd(), "src/app/admin/attendees");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

  it("has no code that calls Stripe", () => {
    const sources = files(root).filter((f) => !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) expect(readFileSync(file, "utf8"), file).not.toMatch(/stripe/i);
  });
});
