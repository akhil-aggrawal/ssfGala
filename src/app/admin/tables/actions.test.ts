import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions are reachable by a direct POST, so their own admin check and
// event scope (not the page guard) are what stop a non-admin or another gala.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { moveAttendee, setTableNumber } = await import("./actions");

const ID = "00000000-0000-0000-0000-000000000286";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe.each([
  ["setTableNumber", setTableNumber, "set_table_number", "p_table_id"],
  ["moveAttendee", moveAttendee, "move_attendee", "p_attendee_id"],
] as const)("%s", (_name, action, fn, idArg) => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(action(null, form({ id: ID, table_number: "1" }))).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/tables");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes the change to the admin's active gala", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    await expect(action(null, form({ id: ID, table_number: " 12 " }))).resolves.toEqual({
      ok: true,
      message: "Saved.",
    });
    expect(rpc).toHaveBeenCalledWith(fn, {
      p_actor_id: "admin-1",
      p_event_id: "ev-1",
      [idArg]: ID,
      p_number: "12",
    });
  });

  it("refuses when no gala is active", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: null });
    const result = await action(null, form({ id: ID, table_number: "1" }));
    expect(result?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad id or table number without calling the database", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    expect((await action(null, form({ id: "nope", table_number: "1" })))?.ok).toBe(false);
    expect((await action(null, form({ id: ID, table_number: "<script>" })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows a plain message when the database refuses", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "seating_not_found" } });
    const result = await action(null, form({ id: ID, table_number: "1" }));
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/no longer exists/) });
  });
});
