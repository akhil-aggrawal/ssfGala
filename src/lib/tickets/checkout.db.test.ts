import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { startTicketCheckout, type CheckoutGateway, type CheckoutSession } from "./checkout";

// QA for issue #13: startTicketCheckout against a real local Supabase
// (`supabase start`), so the payments row meets the real schema: check
// constraints, the unique stripe_session_id and the upsert conflict target.
// Stripe is a stand-in that keeps Stripe's idempotency rule: the same key
// returns the same session, the same key with other params is an error.
// Off by default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. It parks the open gala for its run and puts it
// back; its own gala is archived afterwards. Nothing is deleted.
const enabled = process.env.DB_TESTS === "1";

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const ORIGIN = "https://gala.example.test";
let eventId = "";
let parked: { id: string; status: string } | null = null;

function fakeStripe() {
  const sessions = new Map<string, CheckoutSession>();
  const byKey = new Map<string, { params: string; id: string }>();
  const calls = { create: 0, expire: [] as string[] };
  const gateway: CheckoutGateway = {
    async create(params: Stripe.Checkout.SessionCreateParams, key: string) {
      calls.create += 1;
      const body = JSON.stringify(params);
      const seen = byKey.get(key);
      if (seen) {
        if (seen.params !== body) throw new Error("idempotency_error: same key, other params");
        return sessions.get(seen.id)!;
      }
      const item = params.line_items![0];
      const id = `cs_test_${sessions.size + 1}_${Math.random().toString(36).slice(2, 8)}`;
      const session = {
        id,
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: "open" as const,
        amount_total: item.price_data!.unit_amount! * item.quantity!,
      };
      sessions.set(id, session);
      byKey.set(key, { params: body, id });
      // Let a concurrent caller reach Stripe before this one returns.
      await new Promise((r) => setTimeout(r, 20));
      return session;
    },
    async retrieve(id) {
      return sessions.get(id)!;
    },
    async expire(id) {
      calls.expire.push(id);
      const s = { ...sessions.get(id)!, status: "expired" as const, url: null };
      sessions.set(id, s);
      return s;
    },
  };
  return { gateway, sessions, calls };
}

async function buyer(tier: string, people: number) {
  const email = `qa13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data, error } = await db().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;
  const { error: pErr } = await db().from("profiles").insert({ id: userId, email });
  if (pErr) throw pErr;
  await save(userId, tier, people);
  return { userId, email, origin: ORIGIN };
}

async function save(userId: string, tier: string, people: number) {
  const attendees = Array.from({ length: people }, (_, i) => ({
    full_name: `Guest ${i + 1}`,
    email: `guest${i + 1}@example.test`,
  }));
  const { data, error } = await db().rpc("save_pending_ticket_order", {
    p_user_id: userId,
    p_tier_name: tier,
    p_attendees: attendees,
  });
  if (error) throw error;
  return data as string;
}

async function paymentsOf(userId: string) {
  const { data: reg, error } = await db()
    .from("registrations")
    .select("id, status")
    .eq("created_by", userId)
    .single();
  if (error) throw error;
  const { data, error: pErr } = await db()
    .from("payments")
    .select("amount_cents, status, provider, purpose, stripe_session_id, event_id, registration_id")
    .eq("registration_id", reg.id)
    .order("created_at");
  if (pErr) throw pErr;
  return { registration: reg, payments: data };
}

// A client whose payments upsert is refused, as if the row could not be
// stored after Stripe had already made the session (the R1 case).
function refusePaymentInsert(client: ReturnType<typeof db>): ReturnType<typeof db> {
  const bind = (target: object, prop: string | symbol) => {
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop !== "from") return bind(target, prop);
      return (table: string) => {
        const query = target.from(table as "payments");
        if (table !== "payments") return query;
        return new Proxy(query, {
          get(q, qp) {
            if (qp === "upsert") return async () => ({ data: null, error: { message: "insert refused" } });
            return bind(q, qp);
          },
        });
      };
    },
  });
}

describe.skipIf(!enabled)("startTicketCheckout on a real database (issue #13 QA)", () => {
  beforeAll(async () => {
    const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
    parked = data;
    if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
    const { data: event, error } = await db()
      .from("events")
      .insert({ name: "QA checkout gala", year: 20000 + Math.floor(Math.random() * 1e6), status: "open" })
      .select("id")
      .single();
    if (error) throw error;
    eventId = event.id;
    const { error: tErr } = await db().from("seating_tiers").insert([
      { event_id: eventId, name: "Silver", seat_price_cents: 15000, suggested_contribution_cents: 15000 },
      { event_id: eventId, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 },
      { event_id: eventId, name: "Platinum", seat_price_cents: 25000, suggested_contribution_cents: 25000 },
    ]);
    if (tErr) throw tErr;
  });

  afterAll(async () => {
    if (eventId) await db().from("events").update({ status: "archived" }).eq("id", eventId);
    if (parked) await db().from("events").update({ status: parked.status }).eq("id", parked.id);
  });

  it("AC1: charges the DB tier price × live attendees, and follows a DB price change", async () => {
    const b = await buyer("Gold", 3);
    const stripe = fakeStripe();
    const result = await startTicketCheckout(db(), stripe.gateway, b);
    expect(result.kind).toBe("redirect");
    const [session] = [...stripe.sessions.values()];
    expect(session.amount_total).toBe(3 * 20000);

    // The price lives in the database: change it there and the next session follows.
    const { error } = await db()
      .from("seating_tiers")
      .update({ seat_price_cents: 22500 })
      .eq("event_id", eventId)
      .eq("name", "Gold");
    if (error) throw error;
    await startTicketCheckout(db(), stripe.gateway, b);
    const { payments } = await paymentsOf(b.userId);
    expect(payments.map((p) => p.amount_cents)).toEqual([60000, 67500]);
    expect(stripe.calls.expire).toEqual([session.id]);
  });

  it("AC1: a cancelled attendee is not charged", async () => {
    const b = await buyer("Platinum", 3);
    const stripe = fakeStripe();
    await startTicketCheckout(db(), stripe.gateway, b);
    // Back to the form with two people: the third attendee is soft-cancelled.
    await save(b.userId, "Platinum", 2);
    await startTicketCheckout(db(), stripe.gateway, b);
    const { payments } = await paymentsOf(b.userId);
    expect(payments.map((p) => [p.amount_cents, p.status])).toEqual([
      [75000, "pending"],
      [50000, "pending"],
    ]);
    // The old 3-seat session can no longer be paid.
    expect(stripe.calls.expire).toHaveLength(1);
    expect(stripe.sessions.get(payments[0].stripe_session_id!)?.status).toBe("expired");
  });

  it("AC2: the pending payment row with the session ID exists when the redirect URL comes back", async () => {
    const b = await buyer("Silver", 2);
    const stripe = fakeStripe();
    const result = await startTicketCheckout(db(), stripe.gateway, b);
    const { registration, payments } = await paymentsOf(b.userId);
    expect(payments).toEqual([
      {
        amount_cents: 30000,
        status: "pending",
        provider: "stripe",
        purpose: "ticket",
        stripe_session_id: expect.stringMatching(/^cs_test_/),
        event_id: eventId,
        registration_id: registration.id,
      },
    ]);
    expect(result).toEqual({ kind: "redirect", url: `https://checkout.stripe.com/c/pay/${payments[0].stripe_session_id}` });
    expect(registration.status).toBe("pending_payment");
  });

  it("AC3: two clicks in a row reuse the open session and store one payment", async () => {
    const b = await buyer("Gold", 2);
    const stripe = fakeStripe();
    const first = await startTicketCheckout(db(), stripe.gateway, b);
    const second = await startTicketCheckout(db(), stripe.gateway, b);
    expect(second).toEqual(first);
    expect(stripe.calls.create).toBe(1);
    expect((await paymentsOf(b.userId)).payments).toHaveLength(1);
  });

  it("AC3: two clicks at the same time store one payment for one session", async () => {
    const b = await buyer("Silver", 2);
    const stripe = fakeStripe();
    const [a, c] = await Promise.all([
      startTicketCheckout(db(), stripe.gateway, b),
      startTicketCheckout(db(), stripe.gateway, b),
    ]);
    expect(a).toEqual(c);
    expect(stripe.sessions.size).toBe(1);
    const { payments } = await paymentsOf(b.userId);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount_cents).toBe(30000);
  });

  it("AC4: no payment path in checkout changes the registration status", async () => {
    const b = await buyer("Silver", 1);
    const stripe = fakeStripe();
    await startTicketCheckout(db(), stripe.gateway, b);
    // Even a session Stripe reports complete only sends the buyer to the success page.
    const { payments } = await paymentsOf(b.userId);
    const id = payments[0].stripe_session_id!;
    stripe.sessions.set(id, { ...stripe.sessions.get(id)!, status: "complete" });
    const result = await startTicketCheckout(db(), stripe.gateway, b);
    expect(result).toEqual({ kind: "redirect", url: `${ORIGIN}/tickets/checkout/success?session_id=${id}` });
    const after = await paymentsOf(b.userId);
    expect(after.registration.status).toBe("pending_payment");
    expect(after.payments.map((p) => p.status)).toEqual(["pending"]);
  });

  it("R1: a failed payment insert then an unchanged retry reuses the same Stripe session", async () => {
    const b = await buyer("Silver", 2);
    const stripe = fakeStripe();
    await expect(startTicketCheckout(refusePaymentInsert(db()), stripe.gateway, b)).rejects.toThrow(/insert refused/);
    expect((await paymentsOf(b.userId)).payments).toHaveLength(0);

    const result = await startTicketCheckout(db(), stripe.gateway, b);
    expect(stripe.sessions.size).toBe(1);
    const [session] = [...stripe.sessions.values()];
    const { payments } = await paymentsOf(b.userId);
    expect(payments.map((p) => [p.amount_cents, p.stripe_session_id])).toEqual([[30000, session.id]]);
    expect(result).toEqual({ kind: "redirect", url: session.url });
  });

  it("R1: a failed payment insert then a changed order still reaches Stripe (no idempotency lockout)", async () => {
    const b = await buyer("Silver", 3);
    const stripe = fakeStripe();
    await expect(startTicketCheckout(refusePaymentInsert(db()), stripe.gateway, b)).rejects.toThrow(/insert refused/);

    await save(b.userId, "Silver", 2);
    const result = await startTicketCheckout(db(), stripe.gateway, b);
    expect(result.kind).toBe("redirect");
    expect(stripe.sessions.size).toBe(2);
    const { registration, payments } = await paymentsOf(b.userId);
    expect(payments.map((p) => [p.amount_cents, p.status])).toEqual([[30000, "pending"]]);
    expect(registration.status).toBe("pending_payment");
  });
});
