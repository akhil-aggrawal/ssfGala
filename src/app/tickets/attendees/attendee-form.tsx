"use client";

import { useActionState } from "react";
import type { AttendeeInput } from "@/lib/tickets/order";
import { saveAttendees, type AttendeesState } from "./actions";

// One name and email pair per ticket. The server validates every field and
// returns inline errors; the browser's own bubbles are off so the messages
// read the same everywhere.
export function AttendeeForm({
  tier,
  quantity,
  initial,
}: {
  tier: string;
  quantity: number;
  initial: AttendeeInput[];
}) {
  const [state, action, pending] = useActionState<AttendeesState, FormData>(saveAttendees, null);
  const values = state?.values ?? initial;
  const errors = state?.errors ?? {};

  return (
    <form action={action} noValidate className="ticket-form" aria-label="Attendee details">
      <input type="hidden" name="tier" value={tier} />
      <input type="hidden" name="quantity" value={quantity} />

      {state?.message && (
        <p className="ticket-form__error" role="alert">
          {state.message}
        </p>
      )}

      {Array.from({ length: quantity }, (_, i) => {
        const nameError = errors[`name-${i}`];
        const emailError = errors[`email-${i}`];
        // The key changes with each server reply so React resets the inputs to
        // the values the server sent back.
        const key = `${i}-${state ? JSON.stringify(values[i]) : "initial"}`;
        return (
          <fieldset key={key} className="attendee">
            <legend>Attendee {i + 1}</legend>
            <label className="attendee__field">
              Name
              <input
                name="attendee_name"
                autoComplete={i === 0 ? "name" : "off"}
                defaultValue={values[i]?.full_name ?? ""}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `name-${i}-error` : undefined}
              />
            </label>
            {nameError && (
              <p id={`name-${i}-error`} className="attendee__error">
                {nameError}
              </p>
            )}
            <label className="attendee__field">
              Email
              <input
                name="attendee_email"
                type="email"
                autoComplete={i === 0 ? "email" : "off"}
                defaultValue={values[i]?.email ?? ""}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? `email-${i}-error` : undefined}
              />
            </label>
            {emailError && (
              <p id={`email-${i}-error`} className="attendee__error">
                {emailError}
              </p>
            )}
          </fieldset>
        );
      })}

      <button type="submit" className="ticket-form__continue" disabled={pending}>
        {pending ? "Saving…" : "Review"}
      </button>
    </form>
  );
}
