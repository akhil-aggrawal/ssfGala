import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadPendingOrder } from "@/lib/tickets/order";
import { formatUsd, orderTotalCents } from "@/lib/tickets/selection";
import { PayButton } from "../review/pay-button";

// Back from Stripe without paying. Try again runs the same Pay action as
// the review page: it reopens Checkout for this same pending registration
// and writes no attendees. No table number: admins send those later.
export async function OrderRetry() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent("/tickets/cancelled")}`);
  const order = await loadPendingOrder(createSupabaseAdminClient(), user.id);
  if (!order) {
    return (
      <p className="tickets__closed" role="status">
        There is no unpaid order on your account. <Link href="/tickets">Back to tickets</Link>
      </p>
    );
  }

  const quantity = order.attendees.length;
  return (
    <section className="ticket-form ticket-review" aria-label="Unpaid order">
      <dl className="ticket-review__facts">
        <dt>Tier</dt>
        <dd>{order.tier.name}</dd>
        <dt>Quantity</dt>
        <dd>{quantity}</dd>
      </dl>
      <p className="ticket-form__total">
        Total: <strong>{formatUsd(orderTotalCents(order.tier, quantity))}</strong>
      </p>
      <PayButton label="Try again" />
      <Link className="ticket-review__edit" href="/tickets/review">
        Review the order
      </Link>
    </section>
  );
}
