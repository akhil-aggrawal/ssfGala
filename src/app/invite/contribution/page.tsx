import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Seat Contribution — SSF Gala",
  robots: { index: false, follow: false },
};

type SearchParams = PageProps<"/invite/contribution">["searchParams"];

async function Outcome({ searchParams }: { searchParams: SearchParams }) {
  const { status } = await searchParams;
  return (
    <p>
      {status === "paid"
        ? "Thank you. Stripe has your contribution, and we are confirming it now."
        : "No contribution was charged. You can still attend; nothing else is needed."}
    </p>
  );
}

// Where Stripe sends an invited guest back after Checkout, paid or not. It
// only reads: the guests were registered before payment, and the Stripe
// webhook alone marks a contribution paid, so this page changes nothing.
export default function ContributionReturnPage({ searchParams }: PageProps<"/invite/contribution">) {
  return (
    <main className="tickets">
      <h1>You&rsquo;re Registered</h1>
      <p>Your guests are registered. Your table number will be sent to you before the gala.</p>
      <Suspense fallback={null}>
        <Outcome searchParams={searchParams} />
      </Suspense>
      <p>
        <Link href="/">Back to the gala page</Link>
      </p>
    </main>
  );
}
