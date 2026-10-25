import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => logger);

const { sendTicketConfirmation } = await import("./ticket-confirmation");
const { createEmailTransport, outbox } = await import("./transport");
import type { TicketOrder } from "./templates";

const FROM = "SSF Gala <onboarding@resend.dev>";
const memory = () => createEmailTransport({ EMAIL_TRANSPORT: "memory", EMAIL_FROM: FROM });

const order: TicketOrder = {
  registrationId: "reg-32",
  buyerEmail: "buyer@example.test",
  buyerName: "Asha Buyer",
  amountCents: 40000,
  tier: "Gold",
  attendees: [
    { name: "Asha Buyer", email: "buyer@example.test" },
    { name: "Ravi Guest", email: "ravi@example.test" },
  ],
  event: { name: "An Evening That Moves You", dateAt: "2027-01-24T02:00:00Z", venue: "ICC Milpitas" },
};

describe("sendTicketConfirmation", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC1: sends one receipt to the buyer with amount, tier and attendee names", async () => {
    await sendTicketConfirmation(order, memory());
    const receipts = outbox.filter((m) => m.idempotencyKey.startsWith("receipt:"));
    expect(receipts).toHaveLength(1);
    expect(receipts[0].to).toBe("buyer@example.test");
    for (const part of [receipts[0].text, receipts[0].html]) {
      expect(part).toContain("$400");
      expect(part).toContain("Gold");
      expect(part).toContain("Asha Buyer");
      expect(part).toContain("Ravi Guest");
    }
  });

  it("AC2: each attendee gets one confirmation with tier and event details and no table number", async () => {
    await sendTicketConfirmation(order, memory());
    const confirmations = outbox.filter((m) => m.idempotencyKey.startsWith("confirmation:"));
    expect(confirmations.map((m) => m.to)).toEqual(["buyer@example.test", "ravi@example.test"]);
    for (const m of confirmations) {
      expect(m.text).toContain("Gold");
      expect(m.text).toContain("An Evening That Moves You");
      expect(m.text).toContain("Saturday, January 23, 2027");
      expect(m.text).toContain("ICC Milpitas");
      expect(`${m.text} ${m.html}`).not.toMatch(/table/i);
    }
  });

  it("AC4: every email's From address equals EMAIL_FROM", async () => {
    await sendTicketConfirmation(order, memory());
    expect(outbox).toHaveLength(3);
    expect(new Set(outbox.map((m) => m.from))).toEqual(new Set([FROM]));
  });

  it("AC5: a failed send logs the registration id and the other emails still go out", async () => {
    const sent: string[] = [];
    const flaky = {
      send: vi.fn(async (m: { to: string; idempotencyKey: string }) => {
        if (m.idempotencyKey.startsWith("receipt:")) throw new Error("Resend send failed: 500");
        sent.push(m.to);
      }),
    };
    await expect(sendTicketConfirmation(order, flaky)).resolves.toBeUndefined();
    expect(sent).toEqual(["buyer@example.test", "ravi@example.test"]);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: send failed",
      expect.objectContaining({ registrationId: "reg-32", kind: "receipt" }),
    );
  });

  it("escapes attendee names in the HTML", async () => {
    await sendTicketConfirmation({ ...order, attendees: [{ name: "<b>x</b>", email: "x@example.test" }] }, memory());
    expect(outbox.every((m) => !m.html.includes("<b>x</b>"))).toBe(true);
  });
});

describe("createEmailTransport (Resend)", () => {
  it("AC4: posts to Resend with EMAIL_FROM as the sender and an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const t = createEmailTransport({ EMAIL_FROM: FROM, RESEND_API_KEY: "re_test" }, fetchImpl as unknown as typeof fetch);
    await t.send({ to: "a@example.test", subject: "s", html: "<p>h</p>", text: "h", idempotencyKey: "receipt:r1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Idempotency-Key": "receipt:r1" });
    expect(JSON.parse(init.body as string)).toMatchObject({ from: FROM, to: ["a@example.test"], subject: "s" });
  });

  it("throws on a Resend error so the caller can log it", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 422 }));
    const t = createEmailTransport({ EMAIL_FROM: FROM, RESEND_API_KEY: "re_test" }, fetchImpl as unknown as typeof fetch);
    await expect(t.send({ to: "a@example.test", subject: "s", html: "", text: "", idempotencyKey: "k" })).rejects.toThrow("422");
  });

  it("refuses to send without EMAIL_FROM", async () => {
    const t = createEmailTransport({ EMAIL_TRANSPORT: "memory" });
    await expect(t.send({ to: "a@example.test", subject: "s", html: "", text: "", idempotencyKey: "k" })).rejects.toThrow("EMAIL_FROM");
  });
});
