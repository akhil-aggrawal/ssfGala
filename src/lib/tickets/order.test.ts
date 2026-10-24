import { describe, expect, it } from "vitest";
import type { TicketTier } from "./selection";
import { attendeeStep, loadPendingOrder, parseAttendees, saveOrderErrorMessage, type PendingOrder } from "./order";

function form(pairs: [string, string][]) {
  const fd = new FormData();
  for (const [name, email] of pairs) {
    fd.append("attendee_name", name);
    fd.append("attendee_email", email);
  }
  return fd;
}

describe("parseAttendees", () => {
  it("needs one name and email pair per ticket, trimmed", () => {
    const fd = form([
      [" Asha Rao ", "asha@example.test"],
      ["Ben Li", " ben@example.test "],
    ]);
    expect(parseAttendees(fd, 2)).toEqual({
      ok: true,
      attendees: [
        { full_name: "Asha Rao", email: "asha@example.test" },
        { full_name: "Ben Li", email: "ben@example.test" },
      ],
    });
  });

  it("flags each empty or invalid field inline and keeps what was typed", () => {
    const fd = form([
      ["Asha Rao", ""],
      ["", "ben-at-example"],
    ]);
    expect(parseAttendees(fd, 2)).toEqual({
      ok: false,
      errors: {
        "email-0": "Enter an email address.",
        "name-1": "Enter a name.",
        "email-1": "Enter a valid email address, like name@example.com.",
      },
      values: [
        { full_name: "Asha Rao", email: "" },
        { full_name: "", email: "ben-at-example" },
      ],
    });
  });

  it("treats a missing second pair as empty fields, never as one ticket", () => {
    const result = parseAttendees(form([["Asha Rao", "asha@example.test"]]), 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(["name-1", "email-1"]);
  });

  it("ignores pairs beyond the ticket count", () => {
    const fd = form([
      ["Asha Rao", "asha@example.test"],
      ["Extra", "extra@example.test"],
    ]);
    expect(parseAttendees(fd, 1)).toEqual({ ok: true, attendees: [{ full_name: "Asha Rao", email: "asha@example.test" }] });
  });
});

const TIERS: TicketTier[] = [
  { name: "Silver", seatPriceCents: 15000 },
  { name: "Gold", seatPriceCents: 20000 },
];
const PENDING: PendingOrder = {
  registrationId: "reg-1",
  eventId: "event-1",
  tier: { name: "Silver", seatPriceCents: 15000 },
  attendees: [
    { full_name: "Asha Rao", email: "asha@example.test" },
    { full_name: "Ben Li", email: "ben@example.test" },
    { full_name: "Cara Dee", email: "cara@example.test" },
  ],
};

describe("attendeeStep", () => {
  it("uses the tier and quantity from the URL", () => {
    expect(attendeeStep({ tier: "Gold", quantity: "2" }, TIERS, PENDING)).toEqual({ tier: TIERS[1], quantity: 2 });
  });

  it("falls back to the pending order when the URL has no tier", () => {
    expect(attendeeStep({}, TIERS, PENDING)).toEqual({ tier: TIERS[0], quantity: 3 });
  });

  it("has nothing to show with no tier and no pending order", () => {
    expect(attendeeStep({ tier: "Diamond" }, TIERS, null)).toBeNull();
  });
});

type Row = {
  id: string;
  event_id: string;
  seating_tiers: { name: string; seat_price_cents: number } | null;
  attendees: { full_name: string; email: string; created_at: string; cancelled_at: string | null }[];
};

function fakeDb(result: { data: Row | null; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const query = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "maybeSingle"
          ? async () => result
          : (...a: unknown[]) => (calls.push([prop, ...a]), query),
    },
  );
  return { calls, client: { from: (t: string) => (calls.push(["from", t]), query) } };
}

describe("loadPendingOrder", () => {
  it("returns the buyer's pending order with live attendees in entered order", async () => {
    const { client, calls } = fakeDb({
      data: {
        id: "reg-1",
        event_id: "event-1",
        seating_tiers: { name: "Gold", seat_price_cents: 22500 },
        attendees: [
          { full_name: "Ben Li", email: "ben@example.test", created_at: "2026-10-24T10:00:02Z", cancelled_at: null },
          { full_name: "Gone", email: "gone@example.test", created_at: "2026-10-24T10:00:03Z", cancelled_at: "2026-10-24T11:00:00Z" },
          { full_name: "Asha Rao", email: "asha@example.test", created_at: "2026-10-24T10:00:01Z", cancelled_at: null },
        ],
      },
      error: null,
    });
    await expect(loadPendingOrder(client as never, "user-1")).resolves.toEqual({
      registrationId: "reg-1",
      eventId: "event-1",
      tier: { name: "Gold", seatPriceCents: 22500 },
      attendees: [
        { full_name: "Asha Rao", email: "asha@example.test" },
        { full_name: "Ben Li", email: "ben@example.test" },
      ],
    });
    expect(calls).toContainEqual(["eq", "created_by", "user-1"]);
    expect(calls).toContainEqual(["eq", "status", "pending_payment"]);
    expect(calls).toContainEqual(["eq", "kind", "individual"]);
    expect(calls).toContainEqual(["eq", "events.status", "open"]);
  });

  it("is null when the buyer has no pending order", async () => {
    const { client } = fakeDb({ data: null, error: null });
    await expect(loadPendingOrder(client as never, "user-1")).resolves.toBeNull();
  });

  it("throws on a database error", async () => {
    const { client } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(loadPendingOrder(client as never, "user-1")).rejects.toThrow(/boom/);
  });
});

describe("saveOrderErrorMessage", () => {
  it("says plainly when sales closed and nothing was saved", () => {
    expect(saveOrderErrorMessage({ code: "55000", message: "ticket_order_closed" })).toBe(
      "Ticket sales are closed right now. Nothing was saved.",
    );
    expect(saveOrderErrorMessage({ message: "network" })).toBe("Your details could not be saved. Try again.");
  });
});
