"use client";

import { useActionState } from "react";
import type { SeatState } from "./actions";

// One table-number field and Save button, for a sponsored table or a guest.
export function SeatForm({
  action,
  id,
  value,
  label,
}: {
  action: (prev: SeatState, formData: FormData) => Promise<SeatState>;
  id: string;
  value: string | null;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const inputId = `seat-${id}`;
  return (
    <form action={formAction} className="seat-form">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={inputId} className="visually-hidden">
        {label}
      </label>
      <input id={inputId} name="table_number" defaultValue={value ?? ""} maxLength={10} disabled={pending} />
      <button type="submit" disabled={pending}>
        Save
      </button>
      <span role="status" className={state?.ok ? "seat-form__ok" : "seat-form__error"}>
        {state?.message}
      </span>
    </form>
  );
}
