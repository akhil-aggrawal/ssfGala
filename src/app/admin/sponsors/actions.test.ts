import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "@/lib/sponsor/pledge";

// The Server Actions are reachable by a direct POST, so their own admin check
// is what stops a non-admin from creating pledges or guests.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "gala.test", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/supabase/server", () => {
  const table = (rows: object[]) => {
    const q = { select: () => q, eq: () => q, then: (r: (v: unknown) => void) => r({ data: rows, error: null }) };
    return q;
  };
  return {
    createSupabaseAdminClient: () => ({
      rpc,
      from: (name: string) =>
        name === "seating_tiers"
          ? table([{ id: "t-gold", name: "Gold", seat_price_cents: 20000, sponsorship_amount_cents: null, table_inventory: 5 }])
          : table([]),
    }),
  };
});

const { adminPledge, addSponsoredGuest } = await import("./actions");

const TABLE = "00000000-0000-0000-0000-00000000d027";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("admin sponsor actions", () => {
  beforeEach(() => {
    guard.requireRole.mockReset().mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    rpc.mockReset();
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(adminPledge(null, form({}))).rejects.toThrow("FORBIDDEN");
    await expect(addSponsoredGuest(null, form({}))).rejects.toThrow("FORBIDDEN");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/sponsors");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pledges through admin_pledge_sponsorship as the admin and returns one invite link per table", async () => {
    rpc.mockResolvedValue({ data: { sponsorship_id: "sp1", pledged_cents: 400000 }, error: null });
    const state = await adminPledge(null, form({ display_name: "Phone Co", email: "p@example.test", "Gold.tables": "2" }));
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("admin_pledge_sponsorship");
    expect(args).toMatchObject({ p_admin_id: "admin-1", p_event_id: "ev-1", p_display_name: "Phone Co" });
    expect(args.p_tables).toEqual([{ tier_id: "t-gold", count: 2 }]);

    if (!state?.ok) throw new Error("expected ok");
    expect(state.pledged_cents).toBe(400000);
    const tokens = state.links.map((l) => l.url.replace("https://gala.test/invite/", ""));
    expect(tokens.map(hashInviteToken)).toEqual(args.p_token_hashes);
  });

  it("adds one guest to a table in the active gala as the admin", async () => {
    rpc.mockResolvedValue({ data: "reg-1", error: null });
    const state = await addSponsoredGuest(
      null,
      form({ table_id: TABLE, attendee_name: "Ann", attendee_email: "ann@example.test" }),
    );
    expect(state).toEqual({ ok: true, message: "Ann added." });
    expect(rpc).toHaveBeenCalledWith("admin_add_sponsored_guests", {
      p_admin_id: "admin-1",
      p_event_id: "ev-1",
      p_table_id: TABLE,
      p_attendees: [{ full_name: "Ann", email: "ann@example.test" }],
    });
  });

  it("refuses a bad table id or a guest without an email before any database call", async () => {
    expect((await addSponsoredGuest(null, form({ table_id: "x", attendee_name: "A", attendee_email: "a@x.test" })))?.ok).toBe(false);
    expect((await addSponsoredGuest(null, form({ table_id: TABLE, attendee_name: "A", attendee_email: "" })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
