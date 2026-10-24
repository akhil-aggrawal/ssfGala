"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { correctReceipt, recordReceipt } from "./actions";

type Props =
  | { mode: "record"; sponsorshipId: string; label: string }
  | { mode: "correct"; paymentId: string; label: string };

// One offline receipt form: record a new check/transfer, or correct one
// (the original is kept and marked corrected). No card fields, no Stripe.
export function ReceiptForm(props: Props) {
  const [state, action, pending] = useActionState(
    props.mode === "record" ? recordReceipt : correctReceipt,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const key = props.mode === "record" ? props.sponsorshipId : props.paymentId;
  const id = (field: string) => `${props.mode}-${key}-${field}`;

  // Submit by hand so a refused save keeps what the admin typed.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="receipt-form" aria-label={props.label}>
      {props.mode === "record" ? (
        <input type="hidden" name="sponsorship_id" value={props.sponsorshipId} />
      ) : (
        <input type="hidden" name="payment_id" value={props.paymentId} />
      )}
      <fieldset disabled={pending}>
        <label htmlFor={id("amount")}>{props.mode === "record" ? "Amount (USD)" : "Correct amount (USD, 0 voids)"}</label>
        <input id={id("amount")} name="amount" required inputMode="decimal" />
        <label htmlFor={id("date")}>Received date</label>
        <input id={id("date")} name="received_on" type="date" required />
        <button type="submit">
          {pending ? "Saving…" : props.mode === "record" ? "Record receipt" : "Save correction"}
        </button>
      </fieldset>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "gala-form__ok" : "gala-form__error"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
