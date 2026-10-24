"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isTokenShape } from "@/lib/invite/landing";
import { parseGuests, registerErrorMessage, registerPath } from "@/lib/invite/register";
import { hashInviteToken } from "@/lib/sponsor/pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AttendeeErrors, AttendeeInput } from "@/lib/tickets/order";

export type RegisterState =
  | { done: false; values: AttendeeInput[]; errors: AttendeeErrors; message: string }
  | { done: true; count: number }
  | null;

// Register Without Payment on /invite/<token>/register. The guest comes from
// the session and the table from the token; the form only carries names and
// emails. register_sponsored_guests checks the link and the gala again and
// never checks capacity: guests past ten are accepted like any other.
export async function registerGuests(token: string, _prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(registerPath(token))}`);

  const parsed = parseGuests(formData);
  if (!parsed.ok) return { done: false, values: parsed.values, errors: parsed.errors, message: parsed.message };
  if (!isTokenShape(token)) {
    return { done: false, values: parsed.attendees, errors: {}, message: registerErrorMessage({ code: "P0002", message: "" }) };
  }

  const { error } = await createSupabaseAdminClient().rpc("register_sponsored_guests", {
    p_user_id: user.id,
    p_invite_token_hash: hashInviteToken(token),
    p_attendees: parsed.attendees,
  });
  if (error) return { done: false, values: parsed.attendees, errors: {}, message: registerErrorMessage(error) };

  return { done: true, count: parsed.attendees.length };
}
