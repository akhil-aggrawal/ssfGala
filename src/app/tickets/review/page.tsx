import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadPendingOrder } from "@/lib/tickets/order";
import { formatUsd, orderTotalCents } from "@/lib/tickets/selection";

export const metadata: Metadata = { title: "Review Order — SSF Gala" };

// The buyer's saved pending order, read back from the database: tier,
// quantity, attendee names and total. Nothing is paid or confirmed here.
async function Review() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent("/tickets/review")}`);
  const order = await loadPendingOrder(createSupabaseAdminClient(), user.id);
  if (!order) redirect("/tickets");

  const quantity = order.attendees.length;
  return (
    <section className="ticket-form ticket-review" aria-label="Order review">
      <dl className="ticket-review__facts">
        <dt>Tier</dt>
        <dd>{order.tier.name}</dd>
        <dt>Quantity</dt>
        <dd>{quantity}</dd>
      </dl>
      <h2>Attendees</h2>
      <ol className="ticket-review__attendees">
        {order.attendees.map((a, i) => (
          <li key={i}>
            {a.full_name} <span className="ticket-review__email">{a.email}</span>
          </li>
        ))}
      </ol>
      <p className="ticket-form__total">
        Total: <strong>{formatUsd(orderTotalCents(order.tier, quantity))}</strong>
      </p>
      <Link
        className="ticket-review__edit"
        href={`/tickets/attendees?tier=${encodeURIComponent(order.tier.name)}&quantity=${quantity}`}
      >
        Back to attendee details
      </Link>
    </section>
  );
}

export default function ReviewPage() {
  return (
    <main className="tickets">
      <h1>Review Your Order</h1>
      <p>Check the details before payment.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <Review />
      </Suspense>
    </main>
  );
}
