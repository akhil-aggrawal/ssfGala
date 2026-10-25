"use server";

import { revalidatePath } from "next/cache";
import { guestErrorMessage, parseGuestForm } from "@/lib/admin/sponsors";
import { requireRole } from "@/lib/auth/guard";
import { confirmRegistration } from "@/lib/email/guest-confirmation";
import { createEmailTransport } from "@/lib/email/transport";
import { submitPledge, type PledgeState } from "@/lib/sponsor/submit-pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type GuestState = { ok: boolean; message: string } | null;

const PATH = "/admin/sponsors";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin-entered pledges and guests. The admin check runs first; the SQL
// functions scope every write to the active event and write the audit row in
// the same transaction. No payment is taken: pledges are collected offline.

export async function adminPledge(_prev: PledgeState, formData: FormData): Promise<PledgeState> {
  const access = await requireRole("admin", PATH);
  if (!access.eventId) return { ok: false, message: "No active gala. Nothing was pledged." };

  const admin = createSupabaseAdminClient();
  const state = await submitPledge(admin, access.eventId, formData, (args) =>
    admin.rpc("admin_pledge_sponsorship", { p_admin_id: access.user.id, ...args }),
  );
  if (state?.ok) revalidatePath(PATH);
  return state;
}

export async function addSponsoredGuest(_prev: GuestState, formData: FormData): Promise<GuestState> {
  const access = await requireRole("admin", PATH);
  if (!access.eventId) return { ok: false, message: "No active gala. Nothing was saved." };
  const tableId = formData.get("table_id")?.toString() ?? "";
  if (!UUID.test(tableId)) return { ok: false, message: "Pick a table. Nothing was saved." };
  const parsed = parseGuestForm(formData);
  if (!parsed.ok) return parsed;

  const db = createSupabaseAdminClient();
  const { data: registrationId, error } = await db.rpc("admin_add_sponsored_guests", {
    p_admin_id: access.user.id,
    p_event_id: access.eventId,
    p_table_id: tableId,
    p_attendees: parsed.attendees,
  });
  if (error) return { ok: false, message: guestErrorMessage(error) };
  await confirmRegistration(db, registrationId, createEmailTransport());
  revalidatePath(PATH);
  return { ok: true, message: `${parsed.attendees[0].full_name} added.` };
}
