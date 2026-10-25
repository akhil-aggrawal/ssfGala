import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";

// QA for issue #32: the real webhook route against a real local Supabase
// (`supabase start`), with emails kept in the memory outbox. It drives a
// signed Stripe event through apply_stripe_checkout_event and the real
// loadTicketOrder query, so the embedded joins, the purpose/status filters
// and the cancelled-attendee filter meet the real schema.
// Off by default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. It parks the
// open gala for its run and puts it back; its own gala is archived
// afterwards. Nothing is deleted.
const enabled = process.env.DB_TESTS === "1";

const FROM = "SSF Gala <onboarding@resend.dev>";
// Obvious fakes: the webhook only verifies signatures locally, Stripe is never called.
const STRIPE_KEY = "example_stripe_secret_key";
const WEBHOOK_SECRET = "example_webhook_secret";

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const stripe = new Stripe(STRIPE_KEY);
let eventId = "";
let parked: { id: string; status: string } | null = null;
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A buyer with a pending Gold order for three people, then edited to two:
// the third attendee is soft-cancelled and must get nothing.
async function pendingOrder(purpose: "ticket" | "seat_contribution" = "ticket") {
  const t = tag();
  const email = `qa32-buyer-${t}@example.test`;
  const { data, error } = await db().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;
  const { error: pErr } = await db().from("profiles").insert({ id: userId, email, display_name: "Asha Buyer" });
  if (pErr) throw pErr;
  const people = [
    { full_name: "Asha Buyer", email },
    { full_name: "Ravi Guest", email: `qa32-ravi-${t}@example.test` },
    { full_name: "Cancelled Carol", email: `qa32-carol-${t}@example.test` },
  ];
  for (const n of [3, 2]) {
    const { error: sErr } = await db().rpc("save_pending_ticket_order", {
      p_user_id: userId,
      p_tier_name: "Gold",
      p_attendees: people.slice(0, n),
    });
    if (sErr) throw sErr;
  }
  const { data: reg, error: rErr } = await db().from("registrations").select("id").eq("created_by", userId).single();
  if (rErr) throw rErr;
  const sessionId = `cs_test_qa32_${t}`;
  const { error: payErr } = await db().from("payments").insert({
    event_id: eventId,
    registration_id: reg.id,
    provider: "stripe",
    purpose,
    amount_cents: 40000,
    status: "pending",
    stripe_session_id: sessionId,
  });
  if (payErr) throw payErr;
  return { registrationId: reg.id, sessionId, buyer: email, ravi: people[1].email, carol: people[2].email };
}

async function deliver(type: string, sessionId: string, id = `evt_qa32_${tag()}`) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 40000,
        payment_intent: `pi_qa32_${tag()}`,
      },
    },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const res = await POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    }),
  );
  return { status: res.status, id };
}

async function registrationStatus(id: string) {
  const { data, error } = await db().from("registrations").select("status").eq("id", id).single();
  if (error) throw error;
  return data.status;
}

describe.skipIf(!enabled)("ticket confirmation emails through the real webhook route (issue #32 QA)", () => {
  let outbox: { to: string; from: string; subject: string; text: string; html: string; idempotencyKey: string }[];

  beforeAll(async () => {
    outbox = (await import("./transport")).outbox;
    const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
    parked = data;
    if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
    const { data: event, error } = await db()
      .from("events")
      .insert({
        name: "QA Email Gala",
        year: 20000 + Math.floor(Math.random() * 1e6),
        status: "open",
        date_at: "2027-01-24T02:00:00Z",
        venue: "ICC Milpitas",
      })
      .select("id")
      .single();
    if (error) throw error;
    eventId = event.id;
    const { error: tErr } = await db()
      .from("seating_tiers")
      .insert([{ event_id: eventId, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 }]);
    if (tErr) throw tErr;
  });

  afterAll(async () => {
    if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
    if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
  });

  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", STRIPE_KEY);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
    vi.stubEnv("EMAIL_FROM", FROM);
    vi.stubEnv("EMAIL_TRANSPORT", "memory");
    outbox.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("AC1 + AC2 + AC4: a confirmed order sends one receipt and one confirmation per live attendee, all from EMAIL_FROM", async () => {
    const o = await pendingOrder();
    const { status } = await deliver("checkout.session.completed", o.sessionId);
    expect(status).toBe(200);
    expect(await registrationStatus(o.registrationId)).toBe("registered");

    const receipts = outbox.filter((m) => m.idempotencyKey.startsWith("receipt:"));
    expect(receipts.map((m) => m.to)).toEqual([o.buyer]);
    for (const part of [receipts[0].text, receipts[0].html]) {
      expect(part).toContain("$400");
      expect(part).toContain("Gold");
      expect(part).toContain("Asha Buyer");
      expect(part).toContain("Ravi Guest");
      expect(part).not.toContain("Cancelled Carol");
    }

    const confirmations = outbox.filter((m) => m.idempotencyKey.startsWith("confirmation:"));
    expect(confirmations.map((m) => m.to)).toEqual([o.buyer, o.ravi]);
    for (const m of confirmations) {
      expect(m.text).toContain("Gold");
      expect(m.text).toContain("QA Email Gala");
      expect(m.text).toContain("ICC Milpitas");
      expect(m.text).toContain("January 23, 2027");
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/table/i);
    }
    expect(outbox.some((m) => m.to === o.carol)).toBe(false);
    expect(new Set(outbox.map((m) => m.from))).toEqual(new Set([FROM]));
  });

  it("AC3: replaying the event, or a second event for the same session, sends no extra emails", async () => {
    const o = await pendingOrder();
    const first = await deliver("checkout.session.completed", o.sessionId);
    expect(outbox).toHaveLength(3);

    const replay = await deliver("checkout.session.completed", o.sessionId, first.id);
    const second = await deliver("checkout.session.async_payment_succeeded", o.sessionId);
    expect([replay.status, second.status]).toEqual([200, 200]);
    expect(outbox).toHaveLength(3);
  });

  it("AC3: two deliveries of the same event at once send one set of emails", async () => {
    const o = await pendingOrder();
    const id = `evt_qa32_race_${tag()}`;
    const results = await Promise.all([
      deliver("checkout.session.completed", o.sessionId, id),
      deliver("checkout.session.completed", o.sessionId, id),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(outbox).toHaveLength(3);
  });

  it("AC5: a Resend failure logs the registration id and the order stays registered", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "");
    vi.stubEnv("RESEND_API_KEY", "example_resend_key");
    const realFetch = globalThis.fetch;
    const resend = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.resend.com/")) {
        resend(url);
        return new Response('{"message":"internal"}', { status: 500 });
      }
      return realFetch(input, init);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const o = await pendingOrder();
    const { status } = await deliver("checkout.session.completed", o.sessionId);
    expect(status).toBe(200);
    expect(resend).toHaveBeenCalledTimes(3);
    const lines = errors.mock.calls.map(([l]) => JSON.parse(String(l)) as Record<string, unknown>);
    const failed = lines.filter((l) => l.msg === "email: send failed");
    expect(failed).toHaveLength(3);
    for (const l of failed) expect(l.registrationId).toBe(o.registrationId);
    expect(await registrationStatus(o.registrationId)).toBe("registered");
    expect(outbox).toHaveLength(0);
  });

  it("a confirmed seat contribution sends no ticket emails", async () => {
    const o = await pendingOrder("seat_contribution");
    const { status } = await deliver("checkout.session.completed", o.sessionId);
    expect(status).toBe(200);
    // Since #34 the registrant gets one contribution receipt instead.
    expect(outbox.map((m) => m.idempotencyKey)).toEqual([`contribution-receipt:${o.registrationId}`]);
  });
});
