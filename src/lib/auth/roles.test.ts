import { describe, expect, it, vi } from "vitest";
import { decideAccess, loadAccess, type Access } from "./roles";

type Row = Record<string, unknown>;

// Fake service-role client: `user_roles` returns roleRows, `events` returns eventRow.
function fakeAdmin(
  roleRows: Row[] | null,
  eventRow: Row | null = { id: "ev1" },
  roleError: { message: string } | null = null,
  eventError: { message: string } | null = null,
) {
  const eq = vi.fn().mockResolvedValue({ data: roleRows, error: roleError });
  const maybeSingle = vi.fn().mockResolvedValue({ data: eventRow, error: eventError });
  const inStatus = vi.fn().mockReturnValue({ maybeSingle });
  const from = vi.fn((table: string) => ({
    select: () => (table === "user_roles" ? { eq } : { in: inStatus }),
  }));
  return { client: { from } as never, from, eq, inStatus };
}

const user = { id: "u1", email: "a@example.test" };

describe("loadAccess", () => {
  it("returns no roles for a user with none", async () => {
    const admin = fakeAdmin([]);
    const access = await loadAccess(admin.client, user);
    expect(access).toEqual({ user, roles: [], eventId: "ev1" });
    expect(admin.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("returns the one role a user holds", async () => {
    const access = await loadAccess(fakeAdmin([{ role: "sponsor" }]).client, user);
    expect(access.roles).toEqual(["sponsor"]);
  });

  it("returns both roles for a user with admin and sponsor", async () => {
    const access = await loadAccess(
      fakeAdmin([{ role: "admin" }, { role: "sponsor" }]).client,
      user,
    );
    expect(access.roles).toEqual(["admin", "sponsor"]);
  });

  it("scopes to the active (draft or open) event, or null when there is none", async () => {
    const admin = fakeAdmin([], null);
    const access = await loadAccess(admin.client, user);
    expect(admin.inStatus).toHaveBeenCalledWith("status", ["draft", "open"]);
    expect(access.eventId).toBeNull();
  });

  it("throws when the roles query fails, so a DB error never reads as no role", async () => {
    const admin = fakeAdmin(null, { id: "ev1" }, { message: "boom" });
    await expect(loadAccess(admin.client, user)).rejects.toThrow("boom");
  });

  // QA #8: a failed event lookup must not read as "no active event".
  it("throws when the active-event query fails", async () => {
    const admin = fakeAdmin([{ role: "admin" }], null, null, { message: "event boom" });
    await expect(loadAccess(admin.client, user)).rejects.toThrow("event boom");
  });
});

describe("decideAccess", () => {
  const access = (roles: Access["roles"]): Access => ({ user, roles, eventId: "ev1" });

  it("sends a signed-out visitor to sign-in", () => {
    expect(decideAccess(null, "admin")).toBe("signin");
  });

  it("forbids a signed-in user with no role", () => {
    expect(decideAccess(access([]), "admin")).toBe("forbidden");
  });

  it("forbids a user whose one role is not the required one", () => {
    expect(decideAccess(access(["sponsor"]), "admin")).toBe("forbidden");
  });

  it("allows a user with one matching role", () => {
    expect(decideAccess(access(["admin"]), "admin")).toBe("allow");
  });

  it("allows a user with admin and sponsor into admin and sponsor areas", () => {
    expect(decideAccess(access(["admin", "sponsor"]), "admin")).toBe("allow");
    expect(decideAccess(access(["admin", "sponsor"]), "sponsor")).toBe("allow");
  });
});
