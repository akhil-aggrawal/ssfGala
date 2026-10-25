import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => logger);

const { notifyCancellation, sendTableAssignments } = await import("./seating-notices");
const { createEmailTransport, outbox } = await import("./transport");

const FROM = "SSF Gala <onboarding@resend.dev>";
const memory = () => createEmailTransport({ EMAIL_TRANSPORT: "memory", EMAIL_FROM: FROM });
const event = { name: "An Evening That Moves You", dateAt: "2027-01-24T02:00:00Z", venue: "ICC Milpitas" };

const guests = [
  { id: "att-1", fullName: "Asha Guest", email: "asha@example.test", tableNumber: "12" },
  { id: "att-2", fullName: "Ravi Guest", email: "ravi@example.test", tableNumber: null },
  { id: "att-3", fullName: "Carol Comp", email: "carol@example.test", tableNumber: "VIP-1" },
];

describe("sendTableAssignments", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC1: emails each assigned attendee their own table number, one email each", async () => {
    await sendTableAssignments(event, guests, memory());
    expect(outbox.map((m) => m.to)).toEqual(["asha@example.test", "carol@example.test"]);
    const [asha, carol] = outbox;
    for (const part of [asha.text, asha.html]) {
      expect(part).toContain("Asha Guest");
      expect(part).toContain("12");
      expect(part).toContain("An Evening That Moves You");
      expect(part).toContain("ICC Milpitas");
    }
    expect(carol.text).toContain("Table VIP-1");
    expect(carol.text).not.toContain("Table 12");
  });

  it("AC1: keys each email by attendee and table, so a repeat click is dropped and a move sends the new table", async () => {
    await sendTableAssignments(event, guests, memory());
    expect(outbox.map((m) => m.idempotencyKey)).toEqual(["table-assignment:att-1:12", "table-assignment:att-3:VIP-1"]);
  });

  it("AC2: skips attendees without a table number and counts them", async () => {
    await expect(sendTableAssignments(event, guests, memory())).resolves.toEqual({ sent: 2, skipped: 1, failed: 0 });
    expect(outbox.map((m) => m.to)).not.toContain("ravi@example.test");
  });

  it("counts and logs a failed send; the rest still go out", async () => {
    const sent: string[] = [];
    const transport = {
      send: vi.fn(async (m: { to: string }) => {
        if (m.to === "asha@example.test") throw new Error("boom");
        sent.push(m.to);
      }),
    };
    await expect(sendTableAssignments(event, guests, transport)).resolves.toEqual({ sent: 1, skipped: 1, failed: 1 });
    expect(sent).toEqual(["carol@example.test"]);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: send failed",
      expect.objectContaining({ attendeeId: "att-1", kind: "table_assignment" }),
    );
  });

  it("escapes guest-entered names in the HTML", async () => {
    await sendTableAssignments(event, [{ ...guests[0], fullName: "<b>Evil</b>" }], memory());
    expect(outbox[0].html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(outbox[0].html).not.toContain("<b>Evil</b>");
  });
});

// A db stub for the one attendee read notifyCancellation makes.
const stubDb = (result: { data: unknown; error: unknown }) => ({
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) }),
});

describe("notifyCancellation", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC3: sends the cancelled attendee one cancellation notice", async () => {
    const db = stubDb({
      data: { id: "att-1", full_name: "Asha Guest", email: "asha@example.test", events: { name: event.name, date_at: event.dateAt, venue: event.venue } },
      error: null,
    });
    await notifyCancellation(db as never, "ev-1", "att-1", memory());
    expect(outbox).toHaveLength(1);
    const [m] = outbox;
    expect(m.to).toBe("asha@example.test");
    expect(m.from).toBe(FROM);
    expect(m.idempotencyKey).toBe("attendee-cancellation:att-1");
    expect(m.subject).toMatch(/cancelled/i);
    for (const part of [m.text, m.html]) {
      expect(part).toContain("Asha Guest");
      expect(part).toContain("An Evening That Moves You");
    }
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/overbook|capacity|full/i);
  });

  it("never throws when the attendee cannot be read", async () => {
    await expect(
      notifyCancellation(stubDb({ data: null, error: { message: "down" } }) as never, "ev-1", "att-x", memory()),
    ).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: cancellation notice failed",
      expect.objectContaining({ attendeeId: "att-x" }),
    );
  });
});
