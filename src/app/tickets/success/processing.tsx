"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { waitForConfirmation } from "@/lib/tickets/confirmation";
import { checkTicketStatus } from "./actions";

// Shown until the Stripe webhook confirms the order. Checks every 2 s for
// up to 60 s; once registered, the server page re-renders as Confirmed.
export function Processing({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    waitForConfirmation(() => checkTicketStatus(sessionId), controller.signal).then((result) => {
      if (result === "registered") router.refresh();
      if (result === "timeout") setTimedOut(true);
    });
    return () => controller.abort();
  }, [sessionId, router]);

  return (
    <div className="ticket-form ticket-status" role="status">
      {timedOut ? (
        <>
          <h2>Still processing</h2>
          <p>
            Your payment is taking longer than usual to confirm. You do not need to pay again. Refresh this page in a
            few minutes to see your confirmation.
          </p>
        </>
      ) : (
        <>
          <h2>Processing your payment</h2>
          <p>Stripe has your payment. We are confirming it now. This page updates by itself.</p>
        </>
      )}
    </div>
  );
}
