import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The success page shows "Confirmed" only once the webhook has set the
// registration to registered, waits before that, and never shows a table.
// It reads through loadTicketConfirmation only; Stripe is never called.
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const confirmation = vi.hoisted(() => ({ loadTicketConfirmation: vi.fn() }));
const stripe = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/tickets/confirmation", () => confirmation);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => "db" }));
vi.mock("@/lib/stripe/server", () => ({ createStripe: stripe, stripeCheckout: stripe }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("./processing", () => ({ Processing: ({ sessionId }: { sessionId: string }) => `PROCESSING ${sessionId}` }));

const { TicketStatus } = await import("./ticket-status");

const render = async (params: Record<string, string>) =>
  renderToStaticMarkup(await TicketStatus({ searchParams: Promise.resolve(params) }));

const order = (status: string) => ({ status, tier: "Gold", attendees: ["Asha Rao", "Ben Li"] });

describe("TicketStatus", () => {
  beforeEach(() => {
    session.getSessionUser.mockReset().mockResolvedValue({ id: "user-1", email: "buyer@example.test" });
    confirmation.loadTicketConfirmation.mockReset().mockResolvedValue(order("registered"));
  });

  it("shows Confirmed, the tier and attendees once registered", async () => {
    const html = await render({ session_id: "cs_test_1" });
    expect(confirmation.loadTicketConfirmation).toHaveBeenCalledWith("db", "user-1", "cs_test_1");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Gold");
    expect(html).toContain("Asha Rao");
    expect(html).toContain("Ben Li");
    expect(stripe).not.toHaveBeenCalled();
  });

  it("shows the processing state, not Confirmed, while pending_payment", async () => {
    confirmation.loadTicketConfirmation.mockResolvedValue(order("pending_payment"));
    const html = await render({ session_id: "cs_test_1" });
    expect(html).toBe("PROCESSING cs_test_1");
    expect(html).not.toContain("Confirmed");
  });

  it("never claims Confirmed for a cancelled or unknown order", async () => {
    confirmation.loadTicketConfirmation.mockResolvedValue(order("cancelled"));
    expect(await render({ session_id: "cs_test_1" })).not.toContain("Confirmed");
    confirmation.loadTicketConfirmation.mockResolvedValue(null);
    expect(await render({ session_id: "cs_other" })).not.toContain("Confirmed");
  });

  it("shows no table number", async () => {
    expect(await render({ session_id: "cs_test_1" })).not.toMatch(/table/i);
  });

  it("sends a signed-out visitor to sign-in and back", async () => {
    session.getSessionUser.mockResolvedValue(null);
    await expect(render({ session_id: "cs_test_1" })).rejects.toThrow(
      "REDIRECT /signin?next=%2Ftickets%2Fsuccess%3Fsession_id%3Dcs_test_1",
    );
    expect(confirmation.loadTicketConfirmation).not.toHaveBeenCalled();
  });
});
