import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action is reachable by a direct POST, so it checks the session,
// the open sale and every field itself, then writes through one RPC.
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const sale = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/tickets/selection", async (orig) => ({
  ...(await orig<typeof import("@/lib/tickets/selection")>()),
  loadTicketSale: sale,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { saveAttendees } = await import("./actions");

const OPEN = {
  open: true,
  tiers: [
    { name: "Silver", seatPriceCents: 15000 },
    { name: "Gold", seatPriceCents: 20000 },
  ],
};

function attendeesForm(pairs: [string, string][], fields: Record<string, string> = { tier: "Gold", quantity: "2" }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const [name, email] of pairs) {
    fd.append("attendee_name", name);
    fd.append("attendee_email", email);
  }
  return fd;
}

const TWO: [string, string][] = [
  ["Asha Rao", "asha@example.test"],
  ["Ben Li", "ben@example.test"],
];

describe("saveAttendees", () => {
  beforeEach(() => {
    session.getSessionUser.mockReset().mockResolvedValue({ id: "user-1", email: "buyer@example.test" });
    sale.mockReset().mockResolvedValue(OPEN);
    rpc.mockReset().mockResolvedValue({ data: "reg-1", error: null });
  });

  it("sends a signed-out visitor to sign-in before any database call", async () => {
    session.getSessionUser.mockResolvedValue(null);
    await expect(saveAttendees(null, attendeesForm(TWO))).rejects.toThrow("REDIRECT /signin?next=%2Ftickets");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("saves one pending order for the signed-in buyer, then goes to review", async () => {
    const fd = attendeesForm(TWO, { tier: "Gold", quantity: "2", user_id: "someone-else" });
    await expect(saveAttendees(null, fd)).rejects.toThrow("REDIRECT /tickets/review");
    expect(rpc).toHaveBeenCalledWith("save_pending_ticket_order", {
      p_user_id: "user-1",
      p_tier_name: "Gold",
      p_attendees: [
        { full_name: "Asha Rao", email: "asha@example.test" },
        { full_name: "Ben Li", email: "ben@example.test" },
      ],
    });
  });

  it("returns inline errors and saves nothing when an email is empty or invalid", async () => {
    const state = await saveAttendees(null, attendeesForm([["Asha Rao", ""], ["Ben Li", "ben-at-example"]]));
    expect(state?.errors).toEqual({
      "email-0": "Enter an email address.",
      "email-1": "Enter a valid email address, like name@example.com.",
    });
    expect(state?.values[1]).toEqual({ full_name: "Ben Li", email: "ben-at-example" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the buyer back to /tickets when sales closed or the tier is unknown", async () => {
    await expect(saveAttendees(null, attendeesForm(TWO, { tier: "Diamond", quantity: "2" }))).rejects.toThrow(
      "REDIRECT /tickets",
    );
    sale.mockResolvedValue({ open: false, tiers: [] });
    await expect(saveAttendees(null, attendeesForm(TWO))).rejects.toThrow("REDIRECT /tickets");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the typed values and says nothing was saved when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "ticket_order_closed" } });
    const state = await saveAttendees(null, attendeesForm(TWO));
    expect(state?.message).toBe("Ticket sales are closed right now. Nothing was saved.");
    expect(state?.values).toHaveLength(2);
  });
});
