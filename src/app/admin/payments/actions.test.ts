import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions are reachable by a direct POST, so their own admin check
// is what stops a non-admin from recording money.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordReceipt, correctReceipt } = await import("./actions");

const ID = "00000000-0000-0000-0000-00000000d001";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("payments actions", () => {
  beforeEach(() => {
    guard.requireRole.mockReset().mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    rpc.mockReset().mockResolvedValue({ data: "p1", error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(recordReceipt(null, form({}))).rejects.toThrow("FORBIDDEN");
    await expect(correctReceipt(null, form({}))).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/payments");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a partial receipt in cents for the active gala as the admin", async () => {
    const res = await recordReceipt(null, form({ sponsorship_id: ID, amount: "500", received_on: "2027-01-05" }));
    expect(res).toEqual({ ok: true, message: "Receipt recorded." });
    expect(rpc).toHaveBeenCalledWith("record_sponsorship_receipt", {
      p_actor_id: "admin-1",
      p_event_id: "ev-1",
      p_sponsorship_id: ID,
      p_amount_cents: 50000,
      p_received_on: "2027-01-05",
    });
  });

  it("corrects through the history-keeping function, never an update", async () => {
    const res = await correctReceipt(null, form({ payment_id: ID, amount: "350", received_on: "2027-01-13" }));
    expect(res).toEqual({ ok: true, message: "Receipt corrected." });
    expect(rpc.mock.calls[0][0]).toBe("correct_sponsorship_receipt");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_payment_id: ID, p_amount_cents: 35000, p_event_id: "ev-1" });
  });

  it("saves nothing without an active gala or with a malformed id", async () => {
    await expect(recordReceipt(null, form({ sponsorship_id: "x", amount: "5", received_on: "2027-01-05" }))).resolves.toMatchObject({ ok: false });
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: null });
    await expect(recordReceipt(null, form({ sponsorship_id: ID, amount: "5", received_on: "2027-01-05" }))).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
