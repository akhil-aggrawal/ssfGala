import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";

// QA for issue #34: guest confirmations and the seat-contribution receipt
// against a real local Supabase (`supabase start`), emails kept in the memory
// outbox. The registrations come from the real RPCs the Server Actions call
// (register_sponsored_guests, admin_add_sponsored_guests, add_admin_attendees),
// so the embedded joins in loadGuestRegistration and loadContributionReceipt
// meet the real schema. The receipt goes through the real webhook route.
// Off by default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. It parks the
// open gala for its run and puts it back; its own gala is archived
// afterwards. Nothing is deleted.
const enabled = process.env.DB_TESTS === "1";

const FROM = "SSF Gala <onboarding@resend.dev>";
// Obvious fakes: the webhook only verifies signatures locally, Stripe is never called.
const STRIPE_KEY = "example_stripe_secret_key";
const WEBHOOK_SECRET = "example_webhook_secret";
const SPONSOR = "QA Sponsor Co";
// Nothing a guest reads may hint at a table number or how full a table is.
const NO_SEATING = /table|overbook|capacity|full|waitlist|over the limit/i;

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const stripe = new Stripe(STRIPE_KEY);
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let eventId = "";
let tierId = "";
let tableId = "";
let tokenHash = "";
let parked: { id: string; status: string } | null = null;

async function user(name: string) {
  const email = `qa34-${name.toLowerCase().replace(/\W+/g, "-")}-${tag()}@example.test`;
  const { data, error } = await db().auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const { error: pErr } = await db().from("profiles").insert({ id: data.user.id, email, display_name: name });
  if (pErr) throw pErr;
  return { id: data.user.id, email };
}

const guests = (...names: string[]) =>
  names.map((n) => ({ full_name: n, email: `qa34-${n.toLowerCase().replace(/\W+/g, "-")}-${tag()}@example.test` }));

async function deliver(type: string, sessionId: string, amount: number, id = `evt_qa34_${tag()}`, paymentStatus = "paid") {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: paymentStatus,
        amount_total: amount,
        payment_intent: `pi_qa34_${tag()}`,
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

describe.skipIf(!enabled)("guest confirmations and contribution receipts against the real schema (issue #34 QA)", () => {
  let outbox: { to: string; from: string; subject: string; text: string; html: string; idempotencyKey: string }[];
  let confirmRegistration: typeof import("./guest-confirmation").confirmRegistration;
  let memory: () => import("./transport").EmailTransport;

  beforeAll(async () => {
    const transport = await import("./transport");
    outbox = transport.outbox;
    memory = () => transport.createEmailTransport({ EMAIL_TRANSPORT: "memory", EMAIL_FROM: FROM });
    ({ confirmRegistration } = await import("./guest-confirmation"));

    const { data } = await db().from("events").select("id, status").in("status", ["draft", "open"]).maybeSingle();
    parked = data;
    if (parked) await db().from("events").update({ status: "closed" }).eq("id", parked.id);
    const { data: event, error } = await db()
      .from("events")
      .insert({
        name: "QA Guest Email Gala",
        year: 20000 + Math.floor(Math.random() * 1e6),
        status: "open",
        date_at: "2027-01-24T02:00:00Z",
        venue: "ICC Milpitas",
      })
      .select("id")
      .single();
    if (error) throw error;
    eventId = event.id;
    const { data: tier, error: tErr } = await db()
      .from("seating_tiers")
      .insert({ event_id: eventId, name: "Platinum", seat_price_cents: 25000, suggested_contribution_cents: 25000 })
      .select("id")
      .single();
    if (tErr) throw tErr;
    tierId = tier.id;
    const { data: sponsor, error: sErr } = await db()
      .from("sponsors")
      .insert({ event_id: eventId, display_name: SPONSOR, email: `qa34-sponsor-${tag()}@example.test` })
      .select("id")
      .single();
    if (sErr) throw sErr;
    const { data: ship, error: shErr } = await db()
      .from("sponsorships")
      .insert({ event_id: eventId, sponsor_id: sponsor.id, pledged_cents: 250000, status: "committed" })
      .select("id")
      .single();
    if (shErr) throw shErr;
    tokenHash = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    // Capacity 2, so the 3-guest registration below overbooks the table.
    const { data: table, error: tbErr } = await db()
      .from("sponsored_tables")
      .insert({ event_id: eventId, sponsorship_id: ship.id, tier_id: tierId, invite_token_hash: tokenHash, capacity: 2 })
      .select("id")
      .single();
    if (tbErr) throw tbErr;
    tableId = table.id;
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
  });

  it("AC1 + AC4: invited guests on an overbooked table each get one confirmation with tier and sponsor, no table or overbooking", async () => {
    const registrant = await user("Asha Invited");
    const people = guests("Asha Invited", "Ravi Invited", "Meera Invited");
    const { data: regId, error } = await db().rpc("register_sponsored_guests", {
      p_user_id: registrant.id,
      p_invite_token_hash: tokenHash,
      p_attendees: people,
    });
    if (error) throw error;

    await confirmRegistration(db(), regId, memory());

    expect(outbox.map((m) => m.to)).toEqual(people.map((p) => p.email));
    expect(new Set(outbox.map((m) => m.idempotencyKey)).size).toBe(3);
    for (const m of outbox) {
      expect(m.from).toBe(FROM);
      for (const part of [m.text, m.html]) {
        expect(part).toContain("Platinum");
        expect(part).toContain(SPONSOR);
        expect(part).toContain("QA Guest Email Gala");
        expect(part).toContain("ICC Milpitas");
      }
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(NO_SEATING);
    }
  });

  it("AC1: a sponsored guest an admin adds gets one confirmation with tier and sponsor", async () => {
    const admin = await user("Admin Adder");
    const [extra] = guests("Extra Guest");
    const { data: regId, error } = await db().rpc("admin_add_sponsored_guests", {
      p_admin_id: admin.id,
      p_event_id: eventId,
      p_table_id: tableId,
      p_attendees: [extra],
    });
    if (error) throw error;

    await confirmRegistration(db(), regId, memory());

    expect(outbox.map((m) => m.to)).toEqual([extra.email]);
    expect(outbox[0].text).toContain("Tier: Platinum");
    expect(outbox[0].text).toContain(`Guest of: ${SPONSOR}`);
    expect(`${outbox[0].subject} ${outbox[0].text} ${outbox[0].html}`).not.toMatch(NO_SEATING);
  });

  it("AC3: complimentary and offline-paid attendees each get one confirmation, no sponsor line; a cancelled one gets none", async () => {
    const admin = await user("Admin Comp");
    const comp = guests("Carol Comp", "Cancelled Cara");
    const { data: compId, error } = await db().rpc("add_admin_attendees", {
      p_actor_id: admin.id,
      p_event_id: eventId,
      p_kind: "complimentary",
      p_tier_id: tierId,
      p_attendees: comp,
    });
    if (error) throw error;
    const { error: cErr } = await db()
      .from("attendees")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("registration_id", compId)
      .eq("email", comp[1].email);
    if (cErr) throw cErr;
    const paid = guests("Omar Offline", "Priya Offline");
    const { data: paidId, error: pErr } = await db().rpc("add_admin_attendees", {
      p_actor_id: admin.id,
      p_event_id: eventId,
      p_kind: "offline_paid",
      p_tier_id: tierId,
      p_attendees: paid,
      p_amount_cents: 50000,
    });
    if (pErr) throw pErr;

    await confirmRegistration(db(), compId, memory());
    await confirmRegistration(db(), paidId, memory());

    expect(outbox.map((m) => m.to)).toEqual([comp[0].email, paid[0].email, paid[1].email]);
    for (const m of outbox) {
      expect(m.text).toContain("Tier: Platinum");
      expect(m.text).toContain("QA Guest Email Gala");
      expect(m.text).not.toContain("Guest of");
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(NO_SEATING);
    }
  });

  it("AC2 + AC4: a successful seat contribution sends one receipt to the registrant, and a replay sends nothing more", async () => {
    const registrant = await user("Dev Contributor");
    const people = guests("Dev Contributor", "Lena Guest");
    const { data: regId, error } = await db().rpc("register_sponsored_guests", {
      p_user_id: registrant.id,
      p_invite_token_hash: tokenHash,
      p_attendees: people,
    });
    if (error) throw error;
    const sessionId = `cs_test_qa34_${tag()}`;
    const { error: payErr } = await db().from("payments").insert({
      event_id: eventId,
      registration_id: regId,
      provider: "stripe",
      purpose: "seat_contribution",
      amount_cents: 45001,
      status: "pending",
      stripe_session_id: sessionId,
    });
    if (payErr) throw payErr;

    const first = await deliver("checkout.session.completed", sessionId, 45001);
    expect(first.status).toBe(200);
    expect(outbox).toHaveLength(1);
    const [m] = outbox;
    expect(m.to).toBe(registrant.email);
    expect(m.idempotencyKey).toBe(`contribution-receipt:${regId}`);
    for (const part of [m.text, m.html]) {
      expect(part).toContain("$450.01");
      expect(part).toContain("Platinum");
      expect(part).toContain(SPONSOR);
      expect(part).toContain("Dev Contributor");
      expect(part).toContain("Lena Guest");
    }
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(NO_SEATING);

    const replay = await deliver("checkout.session.completed", sessionId, 45001, first.id);
    const second = await deliver("checkout.session.async_payment_succeeded", sessionId, 45001);
    expect([replay.status, second.status]).toEqual([200, 200]);
    expect(outbox).toHaveLength(1);
  });

  it("AC2: an expired contribution session sends no receipt", async () => {
    const registrant = await user("Ivy Abandons");
    const { data: regId, error } = await db().rpc("register_sponsored_guests", {
      p_user_id: registrant.id,
      p_invite_token_hash: tokenHash,
      p_attendees: guests("Ivy Abandons"),
    });
    if (error) throw error;
    const sessionId = `cs_test_qa34_${tag()}`;
    const { error: payErr } = await db().from("payments").insert({
      event_id: eventId,
      registration_id: regId,
      provider: "stripe",
      purpose: "seat_contribution",
      amount_cents: 25000,
      status: "pending",
      stripe_session_id: sessionId,
    });
    if (payErr) throw payErr;

    const { status } = await deliver("checkout.session.expired", sessionId, 25000, `evt_qa34_${tag()}`, "unpaid");
    expect(status).toBe(200);
    expect(outbox).toHaveLength(0);
  });
});
