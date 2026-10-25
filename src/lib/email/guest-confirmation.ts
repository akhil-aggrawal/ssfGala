// Guest confirmations and seat-contribution receipts (issue #34). Server only.
// Invited guests on a sponsored table, admin-added sponsored guests, and
// complimentary or paid-offline attendees each get one confirmation when the
// registration is saved. The Stripe webhook sends the registrant one receipt
// when a seat contribution first succeeds. A failed send is logged with the
// registration id and never undoes the registration.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { log } from "@/lib/log";
import {
  contributionReceiptEmail,
  guestConfirmationEmail,
  type ContributionReceipt,
  type GuestRegistration,
} from "./templates";
import type { EmailMessage, EmailTransport } from "./transport";

type Db = SupabaseClient<Database>;

// The live attendees of one registration, with tier, sponsor and gala.
export async function loadGuestRegistration(db: Db, registrationId: string): Promise<GuestRegistration | null> {
  const { data, error } = await db
    .from("registrations")
    .select(
      "id, seating_tiers!registrations_tier_id_event_id_fkey (name), events!registrations_event_id_fkey (name, date_at, venue), sponsored_tables!registrations_sponsored_table_id_event_id_fkey (sponsorships!sponsored_tables_sponsorship_id_event_id_fkey (sponsors!sponsorships_sponsor_id_event_id_fkey (display_name))), attendees (id, full_name, email, created_at, cancelled_at)",
    )
    .eq("id", registrationId)
    .maybeSingle();
  if (error) throw new Error(`loadGuestRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    registrationId: data.id,
    tier: data.seating_tiers?.name ?? "",
    sponsorName: data.sponsored_tables?.sponsorships?.sponsors?.display_name ?? null,
    attendees: data.attendees
      .filter((a) => a.cancelled_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ id: a.id, name: a.full_name, email: a.email })),
    event: { name: data.events?.name ?? "", dateAt: data.events?.date_at ?? null, venue: data.events?.venue ?? null },
  };
}

// The succeeded seat contribution behind a Checkout Session. Null for any
// other payment (tickets, sponsorships) or an unknown session.
export async function loadContributionReceipt(db: Db, sessionId: string): Promise<ContributionReceipt | null> {
  const { data, error } = await db
    .from("payments")
    .select("amount_cents, registrations!payments_registration_id_event_id_fkey (id, profiles!registrations_created_by_fkey (display_name, email))")
    .eq("stripe_session_id", sessionId)
    .eq("purpose", "seat_contribution")
    .eq("status", "succeeded")
    .maybeSingle();
  if (error) throw new Error(`loadContributionReceipt failed: ${error.message}`);
  const reg = data?.registrations;
  if (!data || !reg) return null;
  const registration = await loadGuestRegistration(db, reg.id);
  if (!registration) return null;
  return {
    registrationId: reg.id,
    registrantEmail: reg.profiles?.email ?? "",
    registrantName: reg.profiles?.display_name ?? null,
    amountCents: data.amount_cents,
    registration,
  };
}

async function sendEach(registrationId: string, transport: EmailTransport, sends: { kind: string; message: EmailMessage }[]) {
  for (const s of sends) {
    try {
      await transport.send(s.message);
    } catch (error) {
      log("error", "email: send failed", { registrationId, kind: s.kind, error: String(error) });
    }
  }
}

// One confirmation per live attendee. Each send stands alone.
export async function sendGuestConfirmations(reg: GuestRegistration, transport: EmailTransport): Promise<void> {
  await sendEach(
    reg.registrationId,
    transport,
    reg.attendees.map((a) => ({
      kind: "guest_confirmation",
      message: { to: a.email, idempotencyKey: `guest-confirmation:${a.id}`, ...guestConfirmationEmail(reg, a) },
    })),
  );
}

// One receipt to the guest who registered and paid.
export async function sendContributionReceipt(receipt: ContributionReceipt, transport: EmailTransport): Promise<void> {
  if (!receipt.registrantEmail) {
    log("error", "email: registrant has no email address", { registrationId: receipt.registrationId });
    return;
  }
  await sendEach(receipt.registrationId, transport, [
    {
      kind: "contribution_receipt",
      message: {
        to: receipt.registrantEmail,
        idempotencyKey: `contribution-receipt:${receipt.registrationId}`,
        ...contributionReceiptEmail(receipt),
      },
    },
  ]);
}

// For Server Actions, right after a registration is saved: load it and
// confirm every attendee. Never throws; the registration stands either way.
export async function confirmRegistration(db: Db, registrationId: string, transport: EmailTransport): Promise<void> {
  try {
    const reg = await loadGuestRegistration(db, registrationId);
    if (reg) await sendGuestConfirmations(reg, transport);
    else log("error", "email: registration not found for confirmation", { registrationId });
  } catch (error) {
    log("error", "email: guest confirmation failed", { registrationId, error: String(error) });
  }
}
