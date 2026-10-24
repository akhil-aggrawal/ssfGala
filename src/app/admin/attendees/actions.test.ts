import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions are reachable by a direct POST, so their own admin check
// and event scope (not the page guard) are what protect each attendee.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { cancelAttendee, updateAttendee } = await import("./actions");

const ID = "00000000-0000-0000-0000-000000000026";
const admin = { user: { id: "admin-1" }, eventId: "event-1" };

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("updateAttendee", () => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(updateAttendee(null, form({ attendee_id: ID, full_name: "A", email: "a@b.test" }))).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/attendees");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves name and email scoped to the admin's active event", async () => {
    guard.requireRole.mockResolvedValue(admin);
    await expect(
      updateAttendee(null, form({ attendee_id: ID, full_name: " Ann ", email: "ann@example.test" })),
    ).resolves.toEqual({ ok: true, message: "Saved." });
    expect(rpc).toHaveBeenCalledWith("admin_update_attendee", {
      p_actor_id: "admin-1",
      p_event_id: "event-1",
      p_attendee_id: ID,
      p_full_name: "Ann",
      p_email: "ann@example.test",
    });
  });

  it("refuses when there is no active gala", async () => {
    guard.requireRole.mockResolvedValue({ ...admin, eventId: null });
    const result = await updateAttendee(null, form({ attendee_id: ID, full_name: "A", email: "a@b.test" }));
    expect(result?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a bad email without calling the database", async () => {
    guard.requireRole.mockResolvedValue(admin);
    const result = await updateAttendee(null, form({ attendee_id: ID, full_name: "A", email: "nope" }));
    expect(result?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cancelAttendee", () => {
  beforeEach(() => {
    guard.requireRole.mockReset();
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(cancelAttendee(null, form({ attendee_id: ID }))).rejects.toThrow("FORBIDDEN");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("soft-cancels through the audited function", async () => {
    guard.requireRole.mockResolvedValue(admin);
    await expect(cancelAttendee(null, form({ attendee_id: ID }))).resolves.toEqual({ ok: true, message: "Cancelled." });
    expect(rpc).toHaveBeenCalledWith("admin_cancel_attendee", {
      p_actor_id: "admin-1",
      p_event_id: "event-1",
      p_attendee_id: ID,
    });
  });

  it("shows a plain message when the database refuses", async () => {
    guard.requireRole.mockResolvedValue(admin);
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "attendee_already_cancelled" } });
    await expect(cancelAttendee(null, form({ attendee_id: ID }))).resolves.toEqual({
      ok: false,
      message: "That attendee is already cancelled.",
    });
  });
});
