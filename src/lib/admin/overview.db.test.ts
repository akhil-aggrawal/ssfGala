import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { loadOverview } from "./overview";

// loadOverview against a real local Supabase (`supabase start`). Off by
// default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. Seeds two archived events, so it never touches
// the one active gala; nothing is deleted.
const enabled = process.env.DB_TESTS === "1";

const db = () =>
  createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

async function insert(table: keyof Database["public"]["Tables"], rows: object[]) {
  const { data, error } = await db().from(table).insert(rows as never).select("id");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as unknown as { id: string }[];
}

// One event with every edge the overview must handle. Bulk inserts list
// every column: PostgREST sends null for a key that one row omits.
async function seedEvent() {
  const [{ id: event_id }] = await insert("events", [
    { name: "DB test gala", year: 10000 + Math.floor(Math.random() * 1e6), status: "archived" },
  ]);
  const [{ id: tier_id }] = await insert("seating_tiers", [
    { event_id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000 },
  ]);
  const [{ id: sponsor_id }] = await insert("sponsors", [
    { event_id, display_name: "DB Sponsor", email: "sponsor@example.test" },
  ]);
  const [s1, s2, s3] = await insert("sponsorships", [
    { event_id, sponsor_id, pledged_cents: 200000, status: "committed" },
    { event_id, sponsor_id, pledged_cents: 250000, status: "committed" },
    { event_id, sponsor_id, pledged_cents: 150000, status: "cancelled" },
  ]);
  const table = (sponsorship_id: string) => ({
    event_id,
    sponsorship_id,
    tier_id,
    invite_token_hash: randomUUID(),
    capacity: 2,
  });
  const [over, full] = await insert("sponsored_tables", [table(s1.id), table(s2.id)]);
  const reg = (kind: string, sponsored_table_id: string | null, status = "registered") => ({
    event_id,
    kind,
    tier_id,
    sponsored_table_id,
    status,
  });
  const [rOver, rFull, rTicket, rCancelled] = await insert("registrations", [
    reg("sponsored", over.id),
    reg("sponsored", full.id),
    reg("individual", null),
    reg("individual", null, "cancelled"),
  ]);
  const guest = (registration_id: string, cancelled_at: string | null = null) => ({
    event_id,
    registration_id,
    full_name: "Guest",
    email: "guest@example.test",
    cancelled_at,
  });
  const now = new Date().toISOString();
  await insert("attendees", [
    guest(rOver.id),
    guest(rOver.id),
    guest(rOver.id), // 3 active on a table of 2: overbooked
    guest(rFull.id),
    guest(rFull.id),
    guest(rFull.id, now), // 2 active on 2: not overbooked
    guest(rTicket.id),
    guest(rCancelled.id), // registration cancelled: not active
  ]);
  const pay = (p: object) => ({
    event_id,
    registration_id: null,
    sponsorship_id: null,
    provider: "stripe",
    purpose: "ticket",
    amount_cents: 0,
    status: "succeeded",
    ...p,
  });
  const ticket = (amount_cents: number, status: string) =>
    pay({ registration_id: rTicket.id, amount_cents, status });
  const receipt = (sponsorship_id: string, amount_cents: number, status = "succeeded") =>
    pay({ sponsorship_id, provider: "offline", purpose: "sponsorship", amount_cents, status });
  await insert("payments", [
    ticket(20000, "succeeded"),
    ticket(15000, "pending"),
    ticket(25000, "refunded"),
    ticket(30000, "failed"),
    pay({ registration_id: rTicket.id, provider: "offline", amount_cents: 7000 }),
    receipt(s1.id, 50000),
    receipt(s2.id, 40000, "pending"),
    receipt(s3.id, 150000),
  ]);
  return event_id;
}

describe.skipIf(!enabled)("loadOverview (local Supabase)", () => {

  it("computes every metric for one event and ignores another event's rows", async () => {
    const eventId = await seedEvent();
    await seedEvent(); // a second event with the same data must not leak in

    expect(await loadOverview(db(), eventId)).toEqual({
      attendeeCount: 6,
      stripeCollectedCents: 20000,
      offlineReceiptsCents: 7000 + 50000 + 150000,
      // (2000 + 2500) - 500 received on committed pledges; s3 is cancelled.
      outstandingSponsorshipCents: 400000,
      overbookedTables: 1,
    });
  });
});
