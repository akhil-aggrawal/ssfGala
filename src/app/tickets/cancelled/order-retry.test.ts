import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The cancel page offers Try again on the same pending order: the same Pay
// action as review, which reopens Checkout for this registration. It reads
// the order only and shows no table number.
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const order = vi.hoisted(() => ({ loadPendingOrder: vi.fn() }));

vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/tickets/order", () => order);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => "db" }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("../review/pay-button", () => ({ PayButton: ({ label }: { label: string }) => `PAY_BUTTON ${label}` }));

const { OrderRetry } = await import("./order-retry");

const render = async () => renderToStaticMarkup(await OrderRetry());

describe("OrderRetry", () => {
  beforeEach(() => {
    session.getSessionUser.mockReset().mockResolvedValue({ id: "user-1", email: "buyer@example.test" });
    order.loadPendingOrder.mockReset().mockResolvedValue({
      registrationId: "reg-1",
      eventId: "event-1",
      tier: { name: "Gold", seatPriceCents: 20000 },
      attendees: [
        { full_name: "Asha Rao", email: "asha@example.test" },
        { full_name: "Ben Li", email: "ben@example.test" },
      ],
    });
  });

  it("offers Try again on the buyer's pending order", async () => {
    const html = await render();
    expect(order.loadPendingOrder).toHaveBeenCalledWith("db", "user-1");
    expect(html).toContain("PAY_BUTTON Try again");
    expect(html).toContain("Gold");
    expect(html).toContain("$400");
  });

  it("shows no table number", async () => {
    expect(await render()).not.toMatch(/table/i);
  });

  it("points back to tickets when there is no unpaid order", async () => {
    order.loadPendingOrder.mockResolvedValue(null);
    const html = await render();
    expect(html).not.toContain("PAY_BUTTON");
    expect(html).toContain('href="/tickets"');
  });

  it("sends a signed-out visitor to sign-in and back", async () => {
    session.getSessionUser.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("REDIRECT /signin?next=%2Ftickets%2Fcancelled");
  });
});
