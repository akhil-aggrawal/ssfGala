import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TicketStatus } from "./ticket-status";

export const metadata: Metadata = { title: "Your Tickets — SSF Gala" };

export default function TicketSuccessPage({ searchParams }: PageProps<"/tickets/success">) {
  return (
    <main className="tickets">
      <h1>Thank You</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <TicketStatus searchParams={searchParams} />
      </Suspense>
      <p>
        <Link href="/">Back to the gala page</Link>
      </p>
    </main>
  );
}
