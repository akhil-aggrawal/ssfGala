"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { addSponsoredGuest } from "./actions";

// Add one guest to a sponsored table. A full table still takes the guest;
// the table list then shows it as overbooked (admins only).
export function GuestForm({ tableId, label }: { tableId: string; label: string }) {
  const [state, action, pending] = useActionState(addSponsoredGuest, null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = (field: string) => `guest-${tableId}-${field}`;

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
    <form ref={formRef} onSubmit={onSubmit} aria-label={label}>
      <input type="hidden" name="table_id" value={tableId} />
      <fieldset disabled={pending} className="gala-form__grid">
        <label htmlFor={id("name")}>Guest name</label>
        <input id={id("name")} name="attendee_name" required autoComplete="off" />
        <label htmlFor={id("email")}>Guest email</label>
        <input id={id("email")} name="attendee_email" type="email" required autoComplete="off" />
        <button type="submit" className="gala-form__save">
          {pending ? "Adding…" : "Add guest"}
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
