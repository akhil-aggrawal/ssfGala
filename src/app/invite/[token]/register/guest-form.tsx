"use client";

import { useActionState, useState } from "react";
import { formatDollars, suggestedTotalCents } from "@/lib/invite/contribution";
import { registerGuests, type RegisterState } from "./actions";

// Attendee count, then one name and email pair per attendee, then an optional
// contribution. The amount starts at the tier's suggested amount × attendees
// and follows the count until the guest types their own; any amount from $0
// is accepted. The server validates every field and prices nothing from the
// browser beyond the amount the guest chose. On success the form gives way
// to the confirmation, which names the tier only.
export function GuestForm({
  token,
  tier,
  max,
  suggestedCents,
}: {
  token: string;
  tier: string;
  max: number;
  suggestedCents: number;
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerGuests.bind(null, token), null);
  const [count, setCount] = useState(1);
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const failedAmount = state && !state.done ? state.amount : undefined;
  const amount = typedAmount ?? failedAmount ?? formatDollars(suggestedTotalCents(suggestedCents, count));

  if (state?.done) {
    return (
      <section className="ticket-form invite-register__done" role="status" aria-labelledby="registered">
        <h2 id="registered">You&rsquo;re registered</h2>
        <p>
          {state.count} attendee{state.count === 1 ? "" : "s"} · Seating tier: <strong>{tier}</strong>
        </p>
        <p>Your table number will be sent to you before the gala.</p>
        {state.message && <p className="ticket-form__error">{state.message}</p>}
      </section>
    );
  }

  const values = state?.values ?? [];
  const errors = state?.errors ?? {};

  return (
    <form action={action} noValidate className="ticket-form" aria-label="Register attendees">
      {state?.message && (
        <p className="ticket-form__error" role="alert">
          {state.message}
        </p>
      )}

      <label className="ticket-form__quantity">
        Number of attendees
        <select name="count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {Array.from({ length: max }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>

      {Array.from({ length: count }, (_, i) => {
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

      <label className="attendee__field invite-register__amount">
        Contribution (USD)
        <span className="invite-register__hint" id="amount-hint">
          Suggested: ${formatDollars(suggestedCents)} per seat. Any amount is welcome, including $0.
        </span>
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setTypedAmount(e.target.value)}
          aria-describedby="amount-hint"
        />
      </label>

      <button type="submit" name="intent" value="contribute" className="ticket-form__continue" disabled={pending}>
        {pending ? "Registering…" : "Contribute & Register"}
      </button>
      <button
        type="submit"
        name="intent"
        value="register"
        className="ticket-form__continue invite-register__secondary"
        disabled={pending}
      >
        Register Without Payment
      </button>
    </form>
  );
}
