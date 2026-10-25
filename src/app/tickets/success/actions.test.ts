import { beforeEach, describe, expect, it, vi } from "vitest";

// The status check is a Server Action the success page polls. It is
// reachable by a direct POST, so it checks the session itself and only
// reads the caller's own order.
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const confirmation = vi.hoisted(() => ({ loadTicketConfirmation: vi.fn() }));

vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/tickets/confirmation", () => confirmation);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => "db" }));

const { checkTicketStatus } = await import("./actions");

describe("checkTicketStatus", () => {
  beforeEach(() => {
    session.getSessionUser.mockReset().mockResolvedValue({ id: "user-1", email: "buyer@example.test" });
    confirmation.loadTicketConfirmation.mockReset().mockResolvedValue({
      status: "registered",
      tier: "Gold",
      attendees: ["Asha Rao"],
    });
  });

  it("returns only the status of the caller's order", async () => {
    await expect(checkTicketStatus("cs_test_1")).resolves.toBe("registered");
    expect(confirmation.loadTicketConfirmation).toHaveBeenCalledWith("db", "user-1", "cs_test_1");
  });

  it("returns null when signed out, without reading", async () => {
    session.getSessionUser.mockResolvedValue(null);
    await expect(checkTicketStatus("cs_test_1")).resolves.toBeNull();
    expect(confirmation.loadTicketConfirmation).not.toHaveBeenCalled();
  });

  it("returns null for an unknown or foreign session", async () => {
    confirmation.loadTicketConfirmation.mockResolvedValue(null);
    await expect(checkTicketStatus("cs_other")).resolves.toBeNull();
  });

  it("ignores a non-string id", async () => {
    await expect(checkTicketStatus(42 as never)).resolves.toBeNull();
    expect(confirmation.loadTicketConfirmation).not.toHaveBeenCalled();
  });
});
