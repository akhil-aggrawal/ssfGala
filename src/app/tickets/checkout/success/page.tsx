import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Payment Received — SSF Gala" };

// Where Stripe sends the buyer after paying. It only reads: the Stripe
// webhook is the one place a payment is marked paid and an order confirmed,
// so opening or reloading this URL changes nothing.
export default function CheckoutSuccessPage() {
  return (
    <main className="tickets">
      <h1>Thank You</h1>
      <p>Stripe has your payment. We are confirming it now and will email your tickets once it is confirmed.</p>
      <p>
        <Link href="/">Back to the gala page</Link>
      </p>
    </main>
  );
}
