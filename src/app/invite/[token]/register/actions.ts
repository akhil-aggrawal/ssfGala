"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin } from "@/lib/auth/origin";
import { getSessionUser } from "@/lib/auth/session";
import { parseContributionCents, startSeatContribution } from "@/lib/invite/contribution";
import { isTokenShape, loadInvite } from "@/lib/invite/landing";
import { parseGuests, registerErrorMessage, registerPath } from "@/lib/invite/register";
import { log } from "@/lib/log";
import { hashInviteToken } from "@/lib/sponsor/pledge";
import { stripeCheckout } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AttendeeErrors, AttendeeInput } from "@/lib/tickets/order";

export type RegisterState =
  | { done: false; values: AttendeeInput[]; errors: AttendeeErrors; message: string; amount?: string }
  | { done: true; count: number; message?: string }
  | null;

// Register on /invite/<token>/register. The guest comes from the session and
// the table from the token; the form carries names, emails and, for
// Contribute & Register, an amount in dollars. register_sponsored_guests
// checks the link and the gala again and never checks capacity.
//
// The guests are registered before any payment: $0 (or Register Without
// Payment) stops there, a positive amount then opens Stripe Checkout.
// Abandoning or failing the payment leaves the registration as it is.
export async function registerGuests(token: string, _prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(registerPath(token))}`);

  const contribute = formData.get("intent") === "contribute";
  const amount = formData.get("amount")?.toString() ?? "";
  const parsed = parseGuests(formData);
  if (!parsed.ok) return { done: false, values: parsed.values, errors: parsed.errors, message: parsed.message, amount };
  const contribution = contribute ? parseContributionCents(amount) : { ok: true as const, cents: 0 };
  if (!contribution.ok) {
    return { done: false, values: parsed.attendees, errors: {}, message: `${contribution.message} Nothing was saved.`, amount };
  }
  if (!isTokenShape(token)) {
    return { done: false, values: parsed.attendees, errors: {}, message: registerErrorMessage({ code: "P0002", message: "" }), amount };
  }

  const db = createSupabaseAdminClient();
  const { data: registrationId, error } = await db.rpc("register_sponsored_guests", {
    p_user_id: user.id,
    p_invite_token_hash: hashInviteToken(token),
    p_attendees: parsed.attendees,
  });
  if (error) return { done: false, values: parsed.attendees, errors: {}, message: registerErrorMessage(error), amount };

  const count = parsed.attendees.length;
  if (contribution.cents === 0) return { done: true, count };

  let checkoutUrl: string;
  try {
    const { data: registration, error: readError } = await db
      .from("registrations")
      .select("event_id")
      .eq("id", registrationId)
      .single();
    if (readError) throw new Error(`registration read failed: ${readError.message}`);
    const invite = await loadInvite(db, token);
    checkoutUrl = await startSeatContribution(db, stripeCheckout(), {
      registrationId,
      eventId: registration.event_id,
      amountCents: contribution.cents,
      tier: invite.kind === "invalid" ? "Gala" : invite.tier,
      email: user.email,
      origin: appOrigin((await headers()).get("origin") ?? ""),
    });
  } catch (err) {
    log("error", "seat contribution checkout failed", { userId: user.id, registrationId, error: String(err) });
    return {
      done: true,
      count,
      message: "We could not start the payment, so you have not been charged. Your registration is saved.",
    };
  }
  redirect(checkoutUrl);
}
