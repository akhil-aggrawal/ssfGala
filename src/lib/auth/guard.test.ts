import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
const roleRows = vi.hoisted(() => ({ rows: [] as { role: string }[] }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN");
  }),
}));
vi.mock("./session", () => ({ getSessionUser: async () => session.user }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === "user_roles"
          ? { eq: async () => ({ data: roleRows.rows, error: null }) }
          : { in: () => ({ maybeSingle: async () => ({ data: { id: "ev1" }, error: null }) }) },
    }),
  }),
}));

const { requireRole } = await import("./guard");

describe("requireRole", () => {
  beforeEach(() => {
    session.user = { id: "u1", email: "a@example.test" };
    roleRows.rows = [];
  });

  it("redirects a signed-out visitor to sign-in with the next path", async () => {
    session.user = null;
    await expect(requireRole("admin", "/admin/tables?x=1")).rejects.toThrow(
      "REDIRECT /signin?next=%2Fadmin%2Ftables%3Fx%3D1",
    );
  });

  it("returns 403 for a signed-in user with no role", async () => {
    await expect(requireRole("admin", "/admin")).rejects.toThrow("FORBIDDEN");
  });

  it("returns 403 for a sponsor-only user", async () => {
    roleRows.rows = [{ role: "sponsor" }];
    await expect(requireRole("admin", "/admin")).rejects.toThrow("FORBIDDEN");
  });

  it("lets a user with admin and sponsor in, with both roles and the event", async () => {
    roleRows.rows = [{ role: "admin" }, { role: "sponsor" }];
    await expect(requireRole("admin", "/admin")).resolves.toEqual({
      user: { id: "u1", email: "a@example.test" },
      roles: ["admin", "sponsor"],
      eventId: "ev1",
    });
  });
});
