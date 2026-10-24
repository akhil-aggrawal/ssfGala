"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin } from "@/lib/auth/origin";
import { getSessionUser } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { stripeCheckout } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { startTicketCheckout, type CheckoutResult } from "@/lib/tickets/checkout";

export type PayState = { message: string } | null;

// Pay with Stripe on /tickets/review. The buyer comes from the session and
// the order and price from the database; the form carries nothing.
export async function payWithStripe(): Promise<PayState> {
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent("/tickets/review")}`);

  const origin = appOrigin((await headers()).get("origin") ?? "");
  let result: CheckoutResult;
  try {
    result = await startTicketCheckout(createSupabaseAdminClient(), stripeCheckout(), {
      userId: user.id,
      email: user.email,
      origin,
    });
  } catch (error) {
    log("error", "ticket checkout failed", { userId: user.id, error: String(error) });
    return { message: "We could not start the payment. You have not been charged. Try again." };
  }
  redirect(result.kind === "redirect" ? result.url : "/tickets");
}
