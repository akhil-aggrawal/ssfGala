import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderRetry } from "./order-retry";

export const metadata: Metadata = { title: "Payment Not Completed — SSF Gala" };

export default function TicketCancelledPage() {
  return (
    <main className="tickets">
      <h1>Payment Not Completed</h1>
      <p>You have not been charged. Your order is saved.</p>
      <Suspense fallback={<p>Loading…</p>}>
        <OrderRetry />
      </Suspense>
    </main>
  );
}
