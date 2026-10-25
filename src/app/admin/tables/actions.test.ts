import { beforeEach, describe, expect, it, vi } from "vitest";

// Server Actions are reachable by a direct POST, so their own admin check and
// event scope (not the page guard) are what stop a non-admin or another gala.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const seating = vi.hoisted(() => ({ loadSeating: vi.fn() }));
vi.mock("@/lib/admin/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/seating")>()),
  ...seating,
}));
const notices = vi.hoisted(() => ({ loadGalaEvent: vi.fn(), sendTableAssignments: vi.fn() }));
vi.mock("@/lib/email/seating-notices", () => notices);
vi.mock("@/lib/email/transport", () => ({ createEmailTransport: () => "transport" }));

const { moveAttendee, sendTableAssignments, setTableNumber } = await import("./actions");

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

describe("sendTableAssignments", () => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    seating.loadSeating.mockReset().mockResolvedValue({ tables: [], guests: [{ id: "g1" }] });
    notices.loadGalaEvent.mockReset().mockResolvedValue({ name: "Gala", dateAt: null, venue: null });
    notices.sendTableAssignments.mockReset().mockResolvedValue({ sent: 3, skipped: 2, failed: 0 });
  });

  it("refuses a non-admin before reading or sending anything", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(sendTableAssignments()).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/tables");
    expect(notices.sendTableAssignments).not.toHaveBeenCalled();
  });

  it("refuses when no gala is active", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: null });
    expect((await sendTableAssignments())?.ok).toBe(false);
    expect(notices.sendTableAssignments).not.toHaveBeenCalled();
  });

  it("AC1/AC2: sends the active gala's guests and reports sent and skipped counts", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    await expect(sendTableAssignments()).resolves.toEqual({
      ok: true,
      message: "Sent 3 table assignments. Skipped 2 guests without a table number.",
    });
    expect(seating.loadSeating).toHaveBeenCalledWith(expect.anything(), "ev-1");
    expect(notices.loadGalaEvent).toHaveBeenCalledWith(expect.anything(), "ev-1");
    expect(notices.sendTableAssignments).toHaveBeenCalledWith(
      { name: "Gala", dateAt: null, venue: null },
      [{ id: "g1" }],
      "transport",
    );
  });

  it("AC4: takes no input at all, so no custom message can reach many attendees", async () => {
    expect(sendTableAssignments.length).toBe(0);
  });

  it("names failed sends in the result", async () => {
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    notices.sendTableAssignments.mockResolvedValue({ sent: 1, skipped: 0, failed: 2 });
    await expect(sendTableAssignments()).resolves.toEqual({
      ok: false,
      message: "Sent 1 table assignment. Skipped 0 guests without a table number. 2 could not be sent; try again.",
    });
  });
});
