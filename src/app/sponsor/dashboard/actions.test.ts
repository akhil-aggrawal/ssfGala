import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions are reachable by a direct POST, so their own sign-in check
// and event scope are what bind a change to the caller and the active gala.
// Ownership and the paid-guest rule are enforced in SQL
// (supabase/tests/sponsor_guest_edits_test.sql).
const guard = vi.hoisted(() => ({ getAccess: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("next/navigation", () => nav);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { removeGuest, updateGuest } = await import("./actions");

const ID = "00000000-0000-0000-0000-0000000002a1";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const editForm = form({ id: ID, full_name: " Ana ", email: "ana@example.test" });

beforeEach(() => {
  guard.getAccess.mockReset();
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe.each([
  ["updateGuest", () => updateGuest(null, editForm)],
  ["removeGuest", () => removeGuest(null, form({ id: ID }))],
] as const)("%s", (_name, run) => {
  it("sends a signed-out visitor to sign in before any database call", async () => {
    guard.getAccess.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("REDIRECT /signin?next=%2Fsponsor%2Fdashboard");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when no gala is active", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: null });
    expect((await run())?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateGuest", () => {
  it("passes the signed-in user and active gala, never a form field, as the owner", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: "ev-1" });
    const fd = form({ id: ID, full_name: " Ana ", email: "ana@example.test", p_user_id: "someone-else" });
    await expect(updateGuest(null, fd)).resolves.toEqual({ ok: true, message: "Saved." });
    expect(rpc).toHaveBeenCalledWith("sponsor_update_guest", {
      p_user_id: "u1",
      p_event_id: "ev-1",
      p_attendee_id: ID,
      p_full_name: "Ana",
      p_email: "ana@example.test",
    });
  });

  it("refuses a bad form without calling the database", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: "ev-1" });
    expect((await updateGuest(null, form({ id: ID, full_name: "", email: "x" })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("removeGuest", () => {
  it("removes through the SQL function with the caller's id", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: "ev-1" });
    await expect(removeGuest(null, form({ id: ID }))).resolves.toEqual({ ok: true, message: "Guest removed." });
    expect(rpc).toHaveBeenCalledWith("sponsor_remove_guest", {
      p_user_id: "u1",
      p_event_id: "ev-1",
      p_attendee_id: ID,
    });
  });

  it("explains when the guest has paid", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: "ev-1" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "sponsor_guest_paid" } });
    expect(await removeGuest(null, form({ id: ID }))).toEqual({
      ok: false,
      message: expect.stringMatching(/has paid/),
    });
  });

  it("refuses a bad id without calling the database", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, eventId: "ev-1" });
    expect((await removeGuest(null, form({ id: "nope" })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
