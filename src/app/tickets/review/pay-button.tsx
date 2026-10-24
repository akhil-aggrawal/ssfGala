"use client";

import { useActionState } from "react";
import { payWithStripe, type PayState } from "./actions";

// Sends the buyer to Stripe Checkout. The button is disabled while the
// request runs; the server reuses an open session if it is clicked again.
export function PayButton() {
  const [state, action, pending] = useActionState<PayState, FormData>(payWithStripe, null);
  return (
    <form action={action} className="ticket-review__pay">
      {state?.message && (
        <p className="ticket-form__error" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" className="ticket-form__continue" disabled={pending}>
        {pending ? "Opening Stripe…" : "Pay with Stripe"}
      </button>
    </form>
  );
}
