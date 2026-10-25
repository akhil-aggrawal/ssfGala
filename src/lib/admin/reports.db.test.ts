import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { loadReports } from "./reports";

// loadReports against a real local Supabase (`supabase start`). Off by
// default; run with DB_TESTS=1 plus NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. Seeds archived events only; nothing is deleted.
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

// Bulk inserts list every column: PostgREST sends null for a key one row omits.
async function seedEvent() {
  const [{ id: event_id }] = await insert("events", [
    { name: "Reports DB test", year: 10000 + Math.floor(Math.random() * 1e6), status: "archived" },
  ]);
  const [gold, silver] = await insert("seating_tiers", [
    { event_id, name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000, table_inventory: 5 },
    { event_id, name: "Silver", seat_price_cents: 15000, suggested_contribution_cents: 15000, table_inventory: 3 },
  ]);
  const [{ id: sponsor_id }] = await insert("sponsors", [
    { event_id, display_name: "Acme", email: "acme@example.test" },
  ]);
  const [s1, s2] = await insert("sponsorships", [
    { event_id, sponsor_id, pledged_cents: 200000, status: "committed" },
    { event_id, sponsor_id, pledged_cents: 150000, status: "cancelled" },
  ]);
  const table = (sponsorship_id: string, tier_id: string, physical_table_number: string) => ({
    event_id,
    sponsorship_id,
    tier_id,
    invite_token_hash: randomUUID(),
    capacity: 2,
    physical_table_number,
  });
  const [t1] = await insert("sponsored_tables", [table(s1.id, gold.id, "7"), table(s2.id, gold.id, "9")]);
  const reg = (kind: string, tier_id: string, sponsored_table_id: string | null, status = "registered") => ({
    event_id,
    kind,
    tier_id,
    sponsored_table_id,
    status,
  });
  const [rT1, rInd, rComp, rGone] = await insert("registrations", [
    reg("sponsored", gold.id, t1.id),
    reg("individual", silver.id, null),
    reg("complimentary", silver.id, null),
    reg("individual", gold.id, null, "cancelled"),
  ]);
  const guest = (registration_id: string, full_name: string, cancelled_at: string | null = null) => ({
    event_id,
    registration_id,
    full_name,
    email: `${full_name.toLowerCase()}@example.test`,
    cancelled_at,
  });
  const now = new Date().toISOString();
  const [ann, , , flo, gus, , , ivy] = await insert("attendees", [
    guest(rT1.id, "Ann"),
    guest(rT1.id, "Ben"),
    guest(rT1.id, "Cy"), // 3 on a table of 2: overbooked
    guest(rInd.id, "Flo"),
    guest(rInd.id, "Gus", now), // cancelled after paying
    guest(rComp.id, "Jo"),
    guest(rComp.id, "Kit", now),
    guest(rGone.id, "Ivy"), // registration cancelled
  ]);
  const pay = (p: object) => ({
    event_id,
    registration_id: null,
    sponsorship_id: null,
    provider: "stripe",
    purpose: "ticket",
    amount_cents: 0,
    status: "succeeded",
    received_at: null,
    ...p,
  });
  const [pInd, pFail, pC1] = await insert("payments", [
    pay({ registration_id: rInd.id, amount_cents: 30000 }),
    pay({ registration_id: rGone.id, amount_cents: 20000, status: "failed" }),
    pay({ registration_id: rT1.id, purpose: "seat_contribution", amount_cents: 5000 }),
    pay({ sponsorship_id: s1.id, provider: "offline", purpose: "sponsorship", amount_cents: 50000, received_at: now }),
    pay({ sponsorship_id: s1.id, provider: "offline", purpose: "sponsorship", amount_cents: 70000, status: "refunded", received_at: now }),
  ]);
  await insert("payment_allocations", [
    { event_id, payment_id: pInd.id, attendee_id: flo.id, amount_cents: 15000 },
    { event_id, payment_id: pInd.id, attendee_id: gus.id, amount_cents: 15000 },
    { event_id, payment_id: pFail.id, attendee_id: ivy.id, amount_cents: 20000 },
    { event_id, payment_id: pC1.id, attendee_id: ann.id, amount_cents: 5000 },
  ]);
  return event_id;
}

describe.skipIf(!enabled)("loadReports (local Supabase)", () => {
  it("totals match the seeded dataset and ignore another event's rows", async () => {
    const eventId = await seedEvent();
    await seedEvent();
    const r = await loadReports(db(), eventId);

    expect(r.tierAllocations.rows).toEqual([
      { tier: "Silver", inventory: 3, allocated: 0, available: 3 },
      { tier: "Gold", inventory: 5, allocated: 1, available: 4 },
    ]);
    expect(r.pledges.total).toEqual({ tables: 1, pledgedCents: 200000 });
    expect(r.roster.map((a) => a.name)).toEqual(["Ann", "Ben", "Cy", "Flo", "Jo"]);
    expect(r.paidTickets.total).toEqual({ seats: 1, amountCents: 15000 });
    expect(r.contributions.total).toEqual({ guests: 1, amountCents: 5000 });
    expect(r.complimentary.total).toBe(1);
    expect(r.offlineReceipts.total).toBe(50000);
    expect(r.balances.total).toEqual({ pledgedCents: 200000, receivedCents: 50000, outstandingCents: 150000 });
    expect(r.overbooked).toEqual([{ table: "7", sponsor: "Acme", tier: "Gold", seated: 3, capacity: 2 }]);
  });
});
