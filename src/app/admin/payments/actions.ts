"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guard";
import { parseReceiptForm, receiptErrorMessage } from "@/lib/admin/receipts";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type ReceiptState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = "/admin/payments";

// Offline receipts only: these actions record what an admin already received
// by check or transfer. Nothing here charges a card or calls Stripe.
// The admin check runs first; the SQL function scopes the write to the
// active event and writes the audit row in the same transaction.

async function adminEvent() {
  const access = await requireRole("admin", PATH);
  return { actorId: access.user.id, eventId: access.eventId };
}

export async function recordReceipt(_prev: ReceiptState, fd: FormData): Promise<ReceiptState> {
  const { actorId, eventId } = await adminEvent();
  if (!eventId) return { ok: false, message: "No active gala. Nothing was saved." };
  const sponsorshipId = fd.get("sponsorship_id")?.toString() ?? "";
  if (!UUID.test(sponsorshipId)) return { ok: false, message: "Pick a sponsorship. Nothing was saved." };
  const parsed = parseReceiptForm(fd);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };

  const { error } = await createSupabaseAdminClient().rpc("record_sponsorship_receipt", {
    p_actor_id: actorId,
    p_event_id: eventId,
    p_sponsorship_id: sponsorshipId,
    p_amount_cents: parsed.value.amount_cents,
    p_received_on: parsed.value.received_on,
  });
  if (error) return { ok: false, message: receiptErrorMessage(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Receipt recorded." };
}

export async function correctReceipt(_prev: ReceiptState, fd: FormData): Promise<ReceiptState> {
  const { actorId, eventId } = await adminEvent();
  if (!eventId) return { ok: false, message: "No active gala. Nothing was saved." };
  const paymentId = fd.get("payment_id")?.toString() ?? "";
  if (!UUID.test(paymentId)) return { ok: false, message: "Unknown receipt. Nothing was saved." };
  const parsed = parseReceiptForm(fd, { allowZero: true });
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };

  const { error } = await createSupabaseAdminClient().rpc("correct_sponsorship_receipt", {
    p_actor_id: actorId,
    p_event_id: eventId,
    p_payment_id: paymentId,
    p_amount_cents: parsed.value.amount_cents,
    p_received_on: parsed.value.received_on,
  });
  if (error) return { ok: false, message: receiptErrorMessage(error) };
  revalidatePath(PATH);
  return { ok: true, message: parsed.value.amount_cents === 0 ? "Receipt voided." : "Receipt corrected." };
}
