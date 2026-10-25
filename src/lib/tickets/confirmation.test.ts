import { describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS, loadTicketConfirmation, waitForConfirmation } from "./confirmation";

type Row = {
  registrations: {
    status: string;
    created_by: string | null;
    seating_tiers: { name: string } | null;
    attendees: { full_name: string; created_at: string; cancelled_at: string | null }[];
  } | null;
} | null;

// Supabase stand-in for the one payments read: records the filters and
// returns `row` (or `error`). Any write would throw.
function fakeDb(row: Row, error: { message: string } | null = null) {
  const filters: unknown[][] = [];
  const query = {
    eq: (...a: unknown[]) => (filters.push(a), query),
    maybeSingle: async () => ({ data: row, error }),
  };
  const client = {
    from: (table: string) => {
      if (table !== "payments") throw new Error(`unexpected table ${table}`);
      return { select: () => query };
    },
  };
  return { client: client as never, filters };
}

const registration = (over: Partial<NonNullable<Row>["registrations"]> = {}) => ({
  registrations: {
    status: "registered",
    created_by: "user-1",
    seating_tiers: { name: "Gold" },
    attendees: [
      { full_name: "Ben Li", created_at: "2026-10-24T10:00:02Z", cancelled_at: null },
      { full_name: "Gone Guest", created_at: "2026-10-24T10:00:03Z", cancelled_at: "2026-10-24T11:00:00Z" },
      { full_name: "Asha Rao", created_at: "2026-10-24T10:00:01Z", cancelled_at: null },
    ],
    ...over,
  },
});

describe("loadTicketConfirmation", () => {
  it("reads the buyer's ticket payment by Stripe session id", async () => {
    const { client, filters } = fakeDb(registration());
    const result = await loadTicketConfirmation(client, "user-1", "cs_test_1");
    expect(filters).toEqual([
      ["stripe_session_id", "cs_test_1"],
      ["purpose", "ticket"],
    ]);
    expect(result).toEqual({ status: "registered", tier: "Gold", attendees: ["Asha Rao", "Ben Li"] });
  });

  it("passes pending_payment through so the page can wait", async () => {
    const { client } = fakeDb(registration({ status: "pending_payment" }));
    expect((await loadTicketConfirmation(client, "user-1", "cs_test_1"))?.status).toBe("pending_payment");
  });

  it("hides another buyer's order", async () => {
    const { client } = fakeDb(registration({ created_by: "user-2" }));
    expect(await loadTicketConfirmation(client, "user-1", "cs_test_1")).toBeNull();
  });

  it("returns null for an unknown session or an empty id", async () => {
    expect(await loadTicketConfirmation(fakeDb(null).client, "user-1", "cs_none")).toBeNull();
    expect(await loadTicketConfirmation(fakeDb(registration()).client, "user-1", "")).toBeNull();
  });

  it("throws on a failed read so an outage never reads as no order", async () => {
    const { client } = fakeDb(null, { message: "boom" });
    await expect(loadTicketConfirmation(client, "user-1", "cs_test_1")).rejects.toThrow("boom");
  });

  it("carries no table number", async () => {
    const { client } = fakeDb(registration());
    const result = await loadTicketConfirmation(client, "user-1", "cs_test_1");
    expect(Object.keys(result!)).toEqual(["status", "tier", "attendees"]);
  });
});

describe("waitForConfirmation", () => {
  it("checks every 2 s for up to 60 s", () => {
    expect(POLL_INTERVAL_MS).toBe(2000);
    expect(POLL_TIMEOUT_MS).toBe(60000);
  });

  it("stops as soon as the registration is registered", async () => {
    vi.useFakeTimers();
    const check = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("pending_payment")
      .mockResolvedValueOnce("pending_payment")
      .mockResolvedValue("registered");
    const done = waitForConfirmation(check);
    await vi.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBe("registered");
    expect(check).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("gives up after 60 s of pending checks", async () => {
    vi.useFakeTimers();
    const check = vi.fn<() => Promise<string | null>>().mockResolvedValue("pending_payment");
    const done = waitForConfirmation(check);
    await vi.advanceTimersByTimeAsync(60000);
    await expect(done).resolves.toBe("timeout");
    expect(check).toHaveBeenCalledTimes(30);
    vi.useRealTimers();
  });

  it("keeps waiting through a failed check", async () => {
    vi.useFakeTimers();
    const check = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("registered");
    const done = waitForConfirmation(check);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(done).resolves.toBe("registered");
    vi.useRealTimers();
  });

  it("stops when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const check = vi.fn<() => Promise<string | null>>().mockResolvedValue("pending_payment");
    const done = waitForConfirmation(check, controller.signal);
    await vi.advanceTimersByTimeAsync(4000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(done).resolves.toBe("aborted");
    expect(check).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
