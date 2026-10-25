import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadTicketConfirmation } from "@/lib/tickets/confirmation";
import { Processing } from "./processing";

type SearchParams = PageProps<"/tickets/success">["searchParams"];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Where Stripe sends the buyer after paying. It only reads: the Stripe
// webhook is the one place a payment is marked paid and an order confirmed,
// so opening or reloading this URL changes nothing. "Confirmed" shows only
// once the registration is registered. No table number: admins send those.
export async function TicketStatus({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sessionId = first((await searchParams).session_id) ?? "";
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/tickets/success?session_id=${sessionId}`)}`);

  const order = await loadTicketConfirmation(createSupabaseAdminClient(), user.id, sessionId);
  if (!order) {
    return (
      <p className="tickets__closed" role="status">
        We could not find this payment on your account. <Link href="/tickets">Back to tickets</Link>
      </p>
    );
  }
  if (order.status === "cancelled") {
    return (
      <p className="tickets__closed" role="status">
        This order was cancelled. <Link href="/tickets">Back to tickets</Link>
      </p>
    );
  }
  if (order.status !== "registered") return <Processing sessionId={sessionId} />;

  return (
    <section className="ticket-form ticket-review" aria-label="Your tickets">
      <h2>Confirmed</h2>
      <p>Your payment is confirmed and your seats are booked.</p>
      <dl className="ticket-review__facts">
        <dt>Tier</dt>
        <dd>{order.tier}</dd>
        <dt>Quantity</dt>
        <dd>{order.attendees.length}</dd>
      </dl>
      <h2>Attendees</h2>
      <ol className="ticket-review__attendees">
        {order.attendees.map((name, i) => (
          <li key={i}>{name}</li>
        ))}
      </ol>
    </section>
  );
}
