import { describe, expect, it } from "vitest";
import {
  MAX_TICKETS,
  continuePath,
  formatUsd,
  loadTicketSale,
  orderTotalCents,
  parseSelection,
  type TicketTier,
} from "./selection";

const TIERS: TicketTier[] = [
  { name: "Silver", seatPriceCents: 15000 },
  { name: "Gold", seatPriceCents: 20000 },
  { name: "Platinum", seatPriceCents: 25000 },
];

describe("orderTotalCents", () => {
  it("is seat price × quantity in integer cents", () => {
    expect(orderTotalCents(TIERS[1], 1)).toBe(20000);
    expect(orderTotalCents(TIERS[1], 3)).toBe(60000);
    expect(orderTotalCents({ name: "Gold", seatPriceCents: 20050 }, 3)).toBe(60150);
  });
});

describe("formatUsd", () => {
  it("shows whole dollars without cents and keeps cents when present", () => {
    expect(formatUsd(15000)).toBe("$150");
    expect(formatUsd(150000)).toBe("$1,500");
    expect(formatUsd(60150)).toBe("$601.50");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("parseSelection", () => {
  it("keeps a known tier and an in-range quantity", () => {
    expect(parseSelection({ tier: "Gold", quantity: "3" }, TIERS)).toEqual({ tier: TIERS[1], quantity: 3 });
  });

  it("drops an unknown tier and falls back to one ticket", () => {
    expect(parseSelection({ tier: "Diamond", quantity: "abc" }, TIERS)).toEqual({ tier: null, quantity: 1 });
    expect(parseSelection({}, TIERS)).toEqual({ tier: null, quantity: 1 });
  });

  it("refuses quantities outside 1..MAX_TICKETS", () => {
    expect(parseSelection({ tier: "Gold", quantity: "0" }, TIERS).quantity).toBe(1);
    expect(parseSelection({ tier: "Gold", quantity: String(MAX_TICKETS + 1) }, TIERS).quantity).toBe(1);
    expect(parseSelection({ tier: "Gold", quantity: "2.5" }, TIERS).quantity).toBe(1);
    expect(parseSelection({ tier: "Gold", quantity: String(MAX_TICKETS) }, TIERS).quantity).toBe(MAX_TICKETS);
  });
});

describe("continuePath", () => {
  const choice = { tier: TIERS[1], quantity: 2 };

  it("sends a signed-in buyer on to attendee details with the choice", () => {
    expect(continuePath(true, choice)).toBe("/tickets/attendees?tier=Gold&quantity=2");
  });

  it("sends a signed-out buyer through sign-in back to /tickets with the choice", () => {
    const path = continuePath(false, choice);
    expect(path).toBe(`/signin?next=${encodeURIComponent("/tickets?tier=Gold&quantity=2")}`);
  });
});

type Row = { status: string; seating_tiers: { name: string; seat_price_cents: number }[] };

function fakeDb(result: { data: Row | null; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    in: (...a: unknown[]) => (calls.push(["in", ...a]), query),
    maybeSingle: async () => result,
  };
  return { calls, client: { from: (t: string) => (calls.push(["from", t]), query) } };
}

describe("loadTicketSale", () => {
  it("returns the open gala's tiers from the database, cheapest first", async () => {
    const { client, calls } = fakeDb({
      data: {
        status: "open",
        seating_tiers: [
          { name: "Platinum", seat_price_cents: 30000 },
          { name: "Silver", seat_price_cents: 17500 },
          { name: "Gold", seat_price_cents: 22500 },
        ],
      },
      error: null,
    });
    await expect(loadTicketSale(client as never)).resolves.toEqual({
      open: true,
      tiers: [
        { name: "Silver", seatPriceCents: 17500 },
        { name: "Gold", seatPriceCents: 22500 },
        { name: "Platinum", seatPriceCents: 30000 },
      ],
    });
    expect(calls[0]).toEqual(["from", "events"]);
  });

  it("is closed when the active gala is a draft, or there is none", async () => {
    const draft = fakeDb({ data: { status: "draft", seating_tiers: [{ name: "Gold", seat_price_cents: 1 }] }, error: null });
    await expect(loadTicketSale(draft.client as never)).resolves.toEqual({ open: false, tiers: [] });
    const none = fakeDb({ data: null, error: null });
    await expect(loadTicketSale(none.client as never)).resolves.toEqual({ open: false, tiers: [] });
  });

  it("throws on a database error so a failure never reads as closed", async () => {
    const { client } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(loadTicketSale(client as never)).rejects.toThrow(/boom/);
  });
});
