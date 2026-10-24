import { describe, expect, it, vi } from "vitest";
import { AUDIT_PAGE_SIZE, listRecentAuditLogs } from "./audit";

// Fake service-role client for audit_logs: select → eq → order → order → limit.
function fakeAdmin(rows: unknown[] | null, error: { message: string } | null = null) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error });
  const orderById = vi.fn().mockReturnValue({ limit });
  const orderByTime = vi.fn().mockReturnValue({ order: orderById });
  const eq = vi.fn().mockReturnValue({ order: orderByTime });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as never, from, select, eq, orderByTime, orderById, limit };
}

const row = {
  id: 7,
  created_at: "2026-10-23T18:00:00Z",
  action: "tier.update",
  entity_type: "seating_tier",
  entity_id: "t1",
  before_data: { seat_price_cents: 20000 },
  after_data: { seat_price_cents: 25000 },
  actor: { email: "admin@example.test", display_name: "Ada" },
};

describe("listRecentAuditLogs", () => {
  it("reads the newest 100 entries for one event, newest first", async () => {
    const admin = fakeAdmin([row]);
    const entries = await listRecentAuditLogs(admin.client, "ev1");
    expect(AUDIT_PAGE_SIZE).toBe(100);
    expect(admin.from).toHaveBeenCalledWith("audit_logs");
    expect(admin.eq).toHaveBeenCalledWith("event_id", "ev1");
    expect(admin.orderByTime).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(admin.orderById).toHaveBeenCalledWith("id", { ascending: false });
    expect(admin.limit).toHaveBeenCalledWith(100);
    expect(entries).toEqual([row]);
  });

  it("returns an empty list when the event has no entries", async () => {
    expect(await listRecentAuditLogs(fakeAdmin(null).client, "ev1")).toEqual([]);
  });

  it("throws when the query fails, so a DB error never reads as no history", async () => {
    await expect(
      listRecentAuditLogs(fakeAdmin(null, { message: "boom" }).client, "ev1"),
    ).rejects.toThrow("boom");
  });
});
