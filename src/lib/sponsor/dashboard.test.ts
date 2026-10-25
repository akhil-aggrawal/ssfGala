import { describe, expect, it } from "vitest";
import { registeredText, toTableCards, type SponsorTableRow } from "./dashboard";
import { hashInviteToken, tableInviteToken } from "./pledge";

const guest = (full_name: string, cancelled_at: string | null = null) => ({
  id: `id-${full_name}`,
  full_name,
  email: `${full_name.toLowerCase()}@example.test`,
  cancelled_at,
});

const row = (over: Partial<SponsorTableRow> = {}): SponsorTableRow => ({
  id: "t1",
  capacity: 10,
  created_at: "2026-10-24T10:00:00Z",
  invite_token_hash: hashInviteToken(tableInviteToken(over.id ?? "t1")),
  seating_tiers: { name: "Gold" },
  sponsorships: { sponsors: { display_name: "Acme Family" } },
  events: { name: "An Evening That Moves You" },
  registrations: [],
  ...over,
});

describe("toTableCards", () => {
  it("makes one card per table, oldest first, numbered from 1", () => {
    const cards = toTableCards([
      row({ id: "b", created_at: "2026-10-24T11:00:00Z", seating_tiers: { name: "Silver" } }),
      row({ id: "a", created_at: "2026-10-24T10:00:00Z" }),
      row({ id: "c", created_at: "2026-10-25T09:00:00Z", seating_tiers: { name: "Platinum" } }),
    ]);
    expect(cards.map((c) => [c.id, c.number, c.tier])).toEqual([
      ["a", 1, "Gold"],
      ["b", 2, "Silver"],
      ["c", 3, "Platinum"],
    ]);
  });

  it("counts every live guest, past capacity too", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Guest${i + 1}`);
    const [card] = toTableCards([
      row({
        registrations: [
          { status: "registered", attendees: names.slice(0, 7).map((n) => guest(n)) },
          { status: "registered", attendees: names.slice(7).map((n) => guest(n)) },
        ],
      }),
    ]);
    expect(card.registered).toBe(12);
    expect(card.guests).toHaveLength(12);
    expect(registeredText(card)).toBe("12 registered / 10 capacity");
  });

  it("leaves out cancelled guests and cancelled registrations", () => {
    const [card] = toTableCards([
      row({
        registrations: [
          { status: "registered", attendees: [guest("Ana"), guest("Ben", "2026-10-24T12:00:00Z")] },
          { status: "cancelled", attendees: [guest("Cy")] },
          { status: "pending_payment", attendees: [guest("Di")] },
        ],
      }),
    ]);
    expect(card.guests.map((g) => g.full_name)).toEqual(["Ana", "Di"]);
    expect(registeredText(card)).toBe("2 registered / 10 capacity");
  });

  it("marks paid guests and keeps their ids", () => {
    const [card] = toTableCards(
      [row({ registrations: [{ status: "registered", attendees: [guest("Ana"), guest("Ben")] }] })],
      new Set(["id-Ben"]),
    );
    expect(card.guests.map((g) => [g.id, g.paid])).toEqual([
      ["id-Ana", false],
      ["id-Ben", true],
    ]);
  });

  it("rebuilds each table's own invite link from its id (#18)", () => {
    const cards = toTableCards([row({ id: "a" }), row({ id: "b", created_at: "2026-10-25T09:00:00Z" })], new Set(), "https://gala.test");
    expect(cards.map((c) => c.inviteUrl)).toEqual([
      `https://gala.test/invite/${tableInviteToken("a")}`,
      `https://gala.test/invite/${tableInviteToken("b")}`,
    ]);
    expect(cards[0]).toMatchObject({ sponsorName: "Acme Family", eventName: "An Evening That Moves You" });
  });

  it("shows no link for a table whose stored hash is not its signed token", () => {
    const [card] = toTableCards([row({ invite_token_hash: "f".repeat(64) })], new Set(), "https://gala.test");
    expect(card.inviteUrl).toBeNull();
  });

  it("returns no cards for no tables", () => {
    expect(toTableCards([])).toEqual([]);
  });
});
