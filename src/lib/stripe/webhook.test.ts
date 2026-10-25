import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => logger);

const { handleStripeWebhook } = await import("./webhook");

// Real Stripe signing with a test secret: the handler runs the SDK's own
// constructEvent, so a bad signature is the SDK's verdict, not a stub's.
const SECRET = "whsec_test_issue14";
const stripe = new Stripe("sk_test_issue14");

function sessionEvent(type: string, session: Partial<Stripe.Checkout.Session>, id = "evt_1") {
  return JSON.stringify({
    id,
    object: "event",
    type,
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        amount_total: 40000,
        payment_status: "paid",
        payment_intent: "pi_1",
        ...session,
      },
    },
  });
}

const sign = (payload: string, secret = SECRET) =>
  stripe.webhooks.generateTestHeaderString({ payload, secret });

describe("handleStripeWebhook", () => {
  const apply = vi.fn();
  const deps = () => ({ stripe, secret: SECRET, apply });

  beforeEach(() => {
    apply.mockReset().mockResolvedValue({ outcome: "confirmed" });
    logger.log.mockReset();
  });

  it("AC1: rejects a bad signature with 400 and changes nothing", async () => {
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload, sign(payload, "whsec_wrong"), deps());
    expect(res.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("AC1: rejects a missing signature header with 400", async () => {
    const res = await handleStripeWebhook(sessionEvent("checkout.session.completed", {}), null, deps());
    expect(res.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("AC1: rejects a body changed after signing with 400", async () => {
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload.replace("40000", "1"), sign(payload), deps());
    expect(res.status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 500 without a webhook secret and changes nothing", async () => {
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload, sign(payload), { ...deps(), secret: undefined });
    expect(res.status).toBe(500);
    expect(apply).not.toHaveBeenCalled();
  });

  it("passes only fields from the signed event to the database", async () => {
    const payload = sessionEvent("checkout.session.completed", {}, "evt_paid");
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(200);
    expect(apply).toHaveBeenCalledWith({
      p_event_id: "evt_paid",
      p_event_type: "checkout.session.completed",
      p_session_id: "cs_test_1",
      p_payment_status: "paid",
      p_amount_total: 40000,
      p_payment_intent_id: "pi_1",
    });
  });

  it("AC2: a replayed event answers 200 so Stripe stops retrying", async () => {
    apply.mockResolvedValue({ outcome: "duplicate" });
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(200);
  });

  it("#32: runs the confirmation step once the database confirms the payment", async () => {
    const onConfirmed = vi.fn().mockResolvedValue(undefined);
    const payload = sessionEvent("checkout.session.completed", {});
    await handleStripeWebhook(payload, sign(payload), { ...deps(), onConfirmed });
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith("cs_test_1");
  });

  it("#32 AC3: a replayed or already settled event sends no emails", async () => {
    const onConfirmed = vi.fn();
    for (const outcome of ["duplicate", "already_settled"]) {
      apply.mockResolvedValue({ outcome });
      const payload = sessionEvent("checkout.session.completed", {});
      const res = await handleStripeWebhook(payload, sign(payload), { ...deps(), onConfirmed });
      expect(res.status).toBe(200);
    }
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("#32 AC5: a failed confirmation step is logged and still answers 200", async () => {
    const onConfirmed = vi.fn().mockRejectedValue(new Error("db down"));
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload, sign(payload), { ...deps(), onConfirmed });
    expect(res.status).toBe(200);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "stripe webhook: post-confirmation step failed",
      expect.objectContaining({ sessionId: "cs_test_1" }),
    );
  });

  it("AC3: logs the session id with the expected and paid amounts on a mismatch", async () => {
    apply.mockResolvedValue({ outcome: "amount_mismatch", expected_cents: 40000 });
    const payload = sessionEvent("checkout.session.completed", { amount_total: 15000 });
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(200);
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "stripe webhook: paid amount does not match the order",
      expect.objectContaining({ sessionId: "cs_test_1", expectedCents: 40000, paidCents: 15000 }),
    );
  });

  it("AC4: hands an expired session to the database (which leaves the order pending)", async () => {
    apply.mockResolvedValue({ outcome: "failed" });
    const payload = sessionEvent("checkout.session.expired", { payment_status: "unpaid", payment_intent: null, amount_total: 40000 });
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(200);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ p_event_type: "checkout.session.expired" }));
    expect(apply.mock.calls[0][0]).not.toHaveProperty("p_payment_intent_id");
  });

  it("reads the payment intent id from an expanded object", async () => {
    const payload = sessionEvent("checkout.session.async_payment_succeeded", { payment_intent: { id: "pi_obj" } as Stripe.PaymentIntent });
    await handleStripeWebhook(payload, sign(payload), deps());
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ p_payment_intent_id: "pi_obj" }));
  });

  it("acknowledges other event types without touching the database", async () => {
    const payload = JSON.stringify({ id: "evt_x", object: "event", type: "customer.created", data: { object: {} } });
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers 500 when the database write fails, so Stripe retries", async () => {
    apply.mockRejectedValue(new Error("connection reset"));
    const payload = sessionEvent("checkout.session.completed", {});
    const res = await handleStripeWebhook(payload, sign(payload), deps());
    expect(res.status).toBe(500);
    expect(logger.log).toHaveBeenCalledWith("error", "stripe webhook: processing failed", expect.objectContaining({ eventId: "evt_1" }));
  });
});
