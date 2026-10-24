import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadTicketSale, parseSelection } from "@/lib/tickets/selection";
import { TicketForm } from "./ticket-form";

export const metadata: Metadata = { title: "Buy Tickets — SSF Gala" };

type SearchParams = PageProps<"/tickets">["searchParams"];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function TicketSale({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const [sale, params] = await Promise.all([loadTicketSale(createSupabaseAdminClient()), searchParams]);
  if (!sale.open) {
    return (
      <p className="tickets__closed" role="status">
        Ticket sales are closed right now. Please check back soon.
      </p>
    );
  }
  // A choice carried back from sign-in (?tier=Gold&quantity=2) is kept.
  const choice = parseSelection({ tier: first(params.tier), quantity: first(params.quantity) }, sale.tiers);
  return <TicketForm tiers={sale.tiers} initialTier={choice.tier?.name ?? null} initialQuantity={choice.quantity} />;
}

export default function TicketsPage({ searchParams }: PageProps<"/tickets">) {
  return (
    <main className="tickets">
      <h1>Buy Tickets</h1>
      <p>Choose a seating tier and how many seats you need.</p>
      <Suspense fallback={<p>Loading tiers…</p>}>
        <TicketSale searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
