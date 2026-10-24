import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { attendeeStep, loadPendingOrder } from "@/lib/tickets/order";
import { formatUsd, loadTicketSale, orderTotalCents } from "@/lib/tickets/selection";
import { AttendeeForm } from "./attendee-form";

export const metadata: Metadata = { title: "Attendee Details — SSF Gala" };

type SearchParams = PageProps<"/tickets/attendees">["searchParams"];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function AttendeeStep({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent("/tickets")}`);

  const db = createSupabaseAdminClient();
  const [sale, pending] = await Promise.all([loadTicketSale(db), loadPendingOrder(db, user.id)]);
  if (!sale.open) {
    return (
      <p className="tickets__closed" role="status">
        Ticket sales are closed right now. Please check back soon.
      </p>
    );
  }
  const step = attendeeStep({ tier: first(params.tier), quantity: first(params.quantity) }, sale.tiers, pending);
  if (!step) redirect("/tickets");

  const { tier, quantity } = step;
  return (
    <>
      <p className="tickets__summary">
        {quantity} × {tier.name} · {formatUsd(orderTotalCents(tier, quantity))} ·{" "}
        <Link href={`/tickets?tier=${encodeURIComponent(tier.name)}&quantity=${quantity}`}>Change</Link>
      </p>
      <AttendeeForm tier={tier.name} quantity={quantity} initial={pending?.attendees ?? []} />
    </>
  );
}

export default function AttendeesPage({ searchParams }: PageProps<"/tickets/attendees">) {
  return (
    <main className="tickets">
      <h1>Attendee Details</h1>
      <p>Enter a name and email for each ticket.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <AttendeeStep searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
