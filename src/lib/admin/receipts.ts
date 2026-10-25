import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { dollarsToCents } from "@/lib/gala/setup";

// Offline sponsorship receipts for /admin/payments: checks and transfers
// recorded against a pledge. Received counts succeeded receipts only; a
// corrected receipt stays listed as 'refunded'. Amounts are integer cents.

export type Receipt = {
  id: string;
  sponsorship_id: string | null;
  amount_cents: number;
  status: string;
  received_at: string | null;
  created_at: string;
  recorder: { email: string | null; display_name: string | null } | null;
};

export type Pledge = {
  id: string;
  pledged_cents: number;
  status: string;
  sponsor: { display_name: string } | null;
};

export type SponsorshipBalance = {
  id: string;
  sponsorName: string;
  status: string;
  pledgedCents: number;
  receivedCents: number;
  outstandingCents: number;
  receipts: Receipt[];
};

export function summarizeSponsorships(pledges: Pledge[], receipts: Receipt[]): SponsorshipBalance[] {
  return pledges.map((p) => {
    const mine = receipts.filter((r) => r.sponsorship_id === p.id);
    const receivedCents = mine
      .filter((r) => r.status === "succeeded")
      .reduce((sum, r) => sum + r.amount_cents, 0);
    return {
      id: p.id,
      sponsorName: p.sponsor?.display_name ?? "Unknown sponsor",
      status: p.status,
      pledgedCents: p.pledged_cents,
      receivedCents,
      outstandingCents: Math.max(0, p.pledged_cents - receivedCents),
      receipts: mine,
    };
  });
}

export type ReceiptInput = { amount_cents: number; received_on: string };
export type ReceiptParse = { ok: true; value: ReceiptInput } | { ok: false; error: string };

const isCalendarDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

// allowZero: a correction to $0 voids the receipt.
export function parseReceiptForm(fd: FormData, { allowZero = false } = {}): ReceiptParse {
  const amount = dollarsToCents(fd.get("amount")?.toString() ?? "");
  if (amount === null) return { ok: false, error: "Amount must be a dollar amount, like 500 or 500.25." };
  if (amount === 0 && !allowZero) return { ok: false, error: "Amount must be more than $0." };
  const date = (fd.get("received_on")?.toString() ?? "").trim();
  if (!isCalendarDate(date)) return { ok: false, error: "Received date is required." };
  return { ok: true, value: { amount_cents: amount, received_on: date } };
}

export function receiptErrorMessage(error: { code?: string; message: string }): string {
  if (error.message.includes("receipt_not_correctable")) {
    return "That receipt was already corrected. Nothing was saved.";
  }
  if (error.code === "55000") return "This gala is archived and read-only. Nothing was saved.";
  if (error.code === "P0002") return "Sponsorship or receipt not found. Nothing was saved.";
  if (error.code === "22023") return "Check the amount and date. Nothing was saved.";
  return "Could not save the receipt. Nothing was saved.";
}

// Every pledge and offline receipt of one event, read with the service-role
// client. The caller must have run requireRole("admin") and pass its eventId.
export async function loadSponsorshipBalances(
  admin: SupabaseClient<Database>,
  eventId: string,
): Promise<SponsorshipBalance[]> {
  const [pledges, receipts] = await Promise.all([
    admin
      .from("sponsorships")
      .select("id, pledged_cents, status, sponsor:sponsors(display_name)")
      .eq("event_id", eventId)
      .order("created_at"),
    admin
      .from("payments")
      .select("id, sponsorship_id, amount_cents, status, received_at, created_at, recorder:profiles(email, display_name)")
      .eq("event_id", eventId)
      .eq("provider", "offline")
      .eq("purpose", "sponsorship")
      .order("created_at"),
  ]);
  if (pledges.error) throw new Error(`loadSponsorshipBalances pledges failed: ${pledges.error.message}`);
  if (receipts.error) throw new Error(`loadSponsorshipBalances receipts failed: ${receipts.error.message}`);
  return summarizeSponsorships(pledges.data ?? [], receipts.data ?? []);
}
