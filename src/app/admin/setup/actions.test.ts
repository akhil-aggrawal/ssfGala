import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action is reachable by a direct POST, so its own admin check (not
// the page guard) is what stops a non-admin from saving a gala.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveGala } = await import("./actions");

function galaForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const fields: Record<string, string> = { name: "Gala 2027", year: "2027", date_local: "", venue: "", status: "draft" };
  for (const tier of ["Silver", "Gold", "Platinum"]) {
    fields[`${tier}.seat_price`] = "150";
    fields[`${tier}.suggested_contribution`] = "150";
    fields[`${tier}.sponsorship_amount`] = "";
    fields[`${tier}.table_inventory`] = "0";
  }
  for (const [k, v] of Object.entries({ ...fields, ...overrides })) fd.set(k, v);
  return fd;
}

describe("saveGala", () => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    rpc.mockReset().mockResolvedValue({ data: "ev1", error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(saveGala(null, galaForm())).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/setup");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves as the signed-in admin with prices in cents", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" } });
    await expect(saveGala(null, galaForm({ "Gold.seat_price": "200.50" }))).resolves.toEqual({
      ok: true,
      message: "Saved.",
    });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("save_gala_setup");
    expect(args.p_actor_id).toBe("admin-1");
    expect(args.p_event_id).toBeUndefined();
    expect(args.p_tiers.find((t: { name: string }) => t.name === "Gold").seat_price_cents).toBe(20050);
  });

  it("rejects a malformed event id without calling the database", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" } });
    await expect(saveGala(null, galaForm({ event_id: "not-a-uuid" }))).resolves.toEqual({
      ok: false,
      message: "Unknown gala. Nothing was saved.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
