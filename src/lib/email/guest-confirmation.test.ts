import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => logger);

const { confirmRegistration, sendContributionReceipt, sendGuestConfirmations } = await import("./guest-confirmation");
const { createEmailTransport, outbox } = await import("./transport");
import type { ContributionReceipt, GuestRegistration } from "./templates";

const FROM = "SSF Gala <onboarding@resend.dev>";
const memory = () => createEmailTransport({ EMAIL_TRANSPORT: "memory", EMAIL_FROM: FROM });
const event = { name: "An Evening That Moves You", dateAt: "2027-01-24T02:00:00Z", venue: "ICC Milpitas" };

const sponsored: GuestRegistration = {
  registrationId: "reg-34",
  tier: "Platinum",
  sponsorName: "Mehta Family",
  attendees: [
    { id: "att-1", name: "Asha Guest", email: "asha@example.test" },
    { id: "att-2", name: "Ravi Guest", email: "ravi@example.test" },
  ],
  event,
};

const complimentary: GuestRegistration = {
  registrationId: "reg-comp",
  tier: "Gold",
  sponsorName: null,
  attendees: [{ id: "att-3", name: "Carol Comp", email: "carol@example.test" }],
  event,
};

const receipt: ContributionReceipt = {
  registrationId: "reg-34",
  registrantEmail: "asha@example.test",
  registrantName: "Asha Guest",
  amountCents: 30000,
  registration: sponsored,
};

// Nothing a guest reads may hint at a table number or how full a table is.
const NO_SEATING = /table|overbook|capacity|full|waitlist|over the limit/i;

describe("sendGuestConfirmations", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC1: each sponsored attendee gets one confirmation with tier and sponsor name and no table number", async () => {
    await sendGuestConfirmations(sponsored, memory());
    expect(outbox.map((m) => m.to)).toEqual(["asha@example.test", "ravi@example.test"]);
    for (const m of outbox) {
      expect(m.from).toBe(FROM);
      for (const part of [m.text, m.html]) {
        expect(part).toContain("Platinum");
        expect(part).toContain("Mehta Family");
        expect(part).toContain("An Evening That Moves You");
        expect(part).toContain("ICC Milpitas");
      }
      expect(m.text).toContain("Saturday, January 23, 2027");
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(NO_SEATING);
    }
  });

  it("AC3: a complimentary or offline-paid attendee gets one confirmation with tier and no sponsor line", async () => {
    await sendGuestConfirmations(complimentary, memory());
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("carol@example.test");
    expect(outbox[0].text).toContain("Tier: Gold");
    expect(outbox[0].text).not.toContain("Guest of");
  });

  it("keys each confirmation by attendee so a resend is dropped by Resend", async () => {
    await sendGuestConfirmations(sponsored, memory());
    expect(outbox.map((m) => m.idempotencyKey)).toEqual(["guest-confirmation:att-1", "guest-confirmation:att-2"]);
  });

  it("escapes guest-entered names in the HTML", async () => {
    await sendGuestConfirmations({ ...sponsored, sponsorName: "<b>Evil</b>", attendees: [sponsored.attendees[0]] }, memory());
    expect(outbox[0].html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(outbox[0].html).not.toContain("<b>Evil</b>");
  });

  it("one failed send is logged with the registration id and the rest still go out", async () => {
    const sent: string[] = [];
    const transport = {
      send: vi.fn(async (m: { to: string }) => {
        if (m.to === "asha@example.test") throw new Error("boom");
        sent.push(m.to);
      }),
    };
    await sendGuestConfirmations(sponsored, transport);
    expect(sent).toEqual(["ravi@example.test"]);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: send failed",
      expect.objectContaining({ registrationId: "reg-34", kind: "guest_confirmation" }),
    );
  });
});

describe("sendContributionReceipt", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC2: sends one receipt to the registrant with amount, tier, sponsor and attendees", async () => {
    await sendContributionReceipt(receipt, memory());
    expect(outbox).toHaveLength(1);
    const [m] = outbox;
    expect(m.to).toBe("asha@example.test");
    expect(m.idempotencyKey).toBe("contribution-receipt:reg-34");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("$300");
      expect(part).toContain("Platinum");
      expect(part).toContain("Mehta Family");
      expect(part).toContain("Asha Guest");
      expect(part).toContain("Ravi Guest");
    }
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(NO_SEATING);
  });

  it("logs and sends nothing when the registrant has no email", async () => {
    await sendContributionReceipt({ ...receipt, registrantEmail: "" }, memory());
    expect(outbox).toHaveLength(0);
    expect(logger.log).toHaveBeenCalledWith("error", "email: registrant has no email address", { registrationId: "reg-34" });
  });
});

describe("confirmRegistration", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("never throws when the registration cannot be read", async () => {
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }),
    };
    await expect(confirmRegistration(db as never, "reg-x", memory())).resolves.toBeUndefined();
    expect(outbox).toHaveLength(0);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: guest confirmation failed",
      expect.objectContaining({ registrationId: "reg-x" }),
    );
  });
});
