import { beforeEach, describe, expect, it, vi } from "vitest";
import { outbox } from "@/lib/email/transport";
import { hashInviteToken } from "@/lib/sponsor/pledge";

// The Server Action is reachable by a direct POST, so it checks sign-in and
// the active event itself, and sends only token hashes to the database.
const guard = vi.hoisted(() => ({ getAccess: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }));

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "gala.test", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/supabase/server", () => {
  const table = (rows: object[]) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (r: (v: unknown) => void) => r({ data: rows, error: null }),
    };
    return q;
  };
  return {
    createSupabaseAdminClient: () => ({
      rpc,
      from: (name: string) =>
        name === "seating_tiers"
          ? table([
              { id: "t-gold", name: "Gold", seat_price_cents: 20000, sponsorship_amount_cents: null, table_inventory: 5 },
              { id: "t-silver", name: "Silver", seat_price_cents: 15000, sponsorship_amount_cents: 150000, table_inventory: 5 },
            ])
          : name === "events"
            ? table([{ name: "An Evening That Moves You", date_at: null, venue: "ICC Milpitas" }])
            : table([]),
    }),
  };
});

const { pledgeTables } = await import("./actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const pledge = form({ display_name: "Acme", email: "a@example.test", "Gold.tables": "2", "Silver.tables": "1" });

describe("pledgeTables", () => {
  beforeEach(() => {
    guard.getAccess.mockReset();
    redirect.mockClear();
    rpc.mockReset().mockResolvedValue({ data: { sponsorship_id: "sp1", pledged_cents: 550000 }, error: null });
  });

  it("sends a signed-out visitor to sign-in before any database call", async () => {
    guard.getAccess.mockResolvedValue(null);
    await expect(pledgeTables(null, pledge)).rejects.toThrow("REDIRECT /signin?next=%2Fsponsor");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when no gala is active", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, roles: [], eventId: null });
    const state = await pledgeTables(null, pledge);
    expect(state?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores only hashes and returns one link per table with the raw token", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, roles: [], eventId: "ev1" });
    const state = await pledgeTables(null, pledge);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("pledge_sponsorship");
    expect(args).toMatchObject({ p_user_id: "u1", p_event_id: "ev1" });
    expect(args.p_tables).toEqual([
      { tier_id: "t-silver", count: 1 },
      { tier_id: "t-gold", count: 2 },
    ]);
    expect(args.p_token_hashes).toHaveLength(3);

    if (!state?.ok) throw new Error("expected ok");
    expect(state.pledged_cents).toBe(550000);
    expect(state.links.map((l) => l.tier_name)).toEqual(["Silver", "Gold", "Gold"]);
    const tokens = state.links.map((l) => l.url.replace("https://gala.test/invite/", ""));
    expect(new Set(tokens).size).toBe(3);
    expect(tokens.map(hashInviteToken)).toEqual(args.p_token_hashes);
    for (const t of tokens) expect(args.p_token_hashes).not.toContain(t);
  });

  it("emails the sponsor once with every table's link and the pledged amount (#33)", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "memory");
    vi.stubEnv("EMAIL_FROM", "SSF Gala <gala@example.test>");
    outbox.length = 0;
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, roles: [], eventId: "ev1" });
    const state = await pledgeTables(null, pledge);
    vi.unstubAllEnvs();

    if (!state?.ok) throw new Error("expected ok");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: "a@example.test", idempotencyKey: "sponsorship:sp1" });
    for (const l of state.links) expect(outbox[0].text).toContain(l.url);
    expect(outbox[0].text).toContain("$5,500");
    expect(outbox[0].text).toContain("No payment was taken online");
  });

  it("explains an inventory refusal", async () => {
    guard.getAccess.mockResolvedValue({ user: { id: "u1" }, roles: [], eventId: "ev1" });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "pledge_inventory: Gold has 1 tables left" } });
    await expect(pledgeTables(null, pledge)).resolves.toEqual({
      ok: false,
      message: "Not enough Gold tables are left (1 available). Nothing was pledged.",
    });
  });
});
