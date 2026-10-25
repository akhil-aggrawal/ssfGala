import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Reports } from "@/lib/admin/reports";

// The export URLs are reachable directly, so the route's own admin check,
// event scope and audit row are what protect the guest PII in them.
const guard = vi.hoisted(() => ({ requireRole: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const loadReports = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => guard);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/admin/reports", () => ({ loadReports }));

const { GET } = await import("./route");

const empty: Reports = {
  tierAllocations: { rows: [], total: { inventory: 0, allocated: 0, available: 0 } },
  pledges: { rows: [], total: { tables: 0, pledgedCents: 0 } },
  roster: [{ name: "Ana", email: "ana@example.test", tier: "Gold", kind: "Ticket", sponsor: null, table: null, paid: true }],
  paidTickets: { rows: [], total: { seats: 0, amountCents: 0 } },
  contributions: { rows: [], total: { guests: 0, amountCents: 0 } },
  complimentary: { rows: [], total: 0 },
  offlineReceipts: { rows: [], total: 0 },
  balances: { rows: [], total: { pledgedCents: 0, receivedCents: 0, outstandingCents: 0 } },
  overbooked: [],
};

const get = (file: string) =>
  GET(new Request(`http://localhost/admin/exports/${file}`), { params: Promise.resolve({ file }) });

describe("GET /admin/exports/[file]", () => {
  beforeEach(() => {
    guard.requireRole.mockReset().mockResolvedValue({ user: { id: "admin-1" }, eventId: "ev-1" });
    rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    loadReports.mockReset().mockResolvedValue(empty);
  });

  it("refuses a non-admin before any database call", async () => {
    guard.requireRole.mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;403"));
    await expect(get("roster.csv")).rejects.toThrow("403");
    expect(guard.requireRole).toHaveBeenCalledWith("admin", "/admin/exports");
    expect(rpc).not.toHaveBeenCalled();
    expect(loadReports).not.toHaveBeenCalled();
  });

  it("sends the roster CSV and audits it, naming the report", async () => {
    const res = await get("roster.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ssf-gala-roster.csv"');
    expect(await res.text()).toContain("Ana,ana@example.test,Gold,Ticket,,,Yes\r\n");
    expect(rpc).toHaveBeenCalledWith("record_audit_log", {
      p_event_id: "ev-1",
      p_actor_id: "admin-1",
      p_action: "report.export",
      p_entity_type: "event",
      p_entity_id: "ev-1",
      p_before_data: null,
      p_after_data: { report: "roster", format: "csv", file: "roster.csv" },
    });
    expect(loadReports).toHaveBeenCalledWith(expect.anything(), "ev-1");
  });

  it("sends the workbook as XLSX", async () => {
    const res = await get("reports.xlsx");
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(rpc.mock.calls[0][1].p_after_data).toEqual({ report: "all", format: "xlsx", file: "reports.xlsx" });
  });

  it("sends no file when the audit row is not written", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(get("roster.csv")).rejects.toThrow("export audit failed");
    expect(loadReports).not.toHaveBeenCalled();
  });

  it("404s an unknown file or no active gala without auditing", async () => {
    expect((await get("secrets.csv")).status).toBe(404);
    guard.requireRole.mockResolvedValue({ user: { id: "admin-1" }, eventId: null });
    expect((await get("roster.csv")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
