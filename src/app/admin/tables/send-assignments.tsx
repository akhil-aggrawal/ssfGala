"use client";

import { useActionState } from "react";
import { sendTableAssignments } from "./actions";

// One button, no message field: emails each guest their own table number.
export function SendAssignments() {
  const [state, formAction, pending] = useActionState(sendTableAssignments, null);
  return (
    <form action={formAction} className="seat-form">
      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send table assignments"}
      </button>
      <span role="status" className={state?.ok ? "seat-form__ok" : "seat-form__error"}>
        {state?.message}
      </span>
    </form>
  );
}
