"use client";

import { useState, useTransition, type FormEvent } from "react";
import { centsToDollars } from "@/lib/gala/setup";
import { addAttendees, type AddAttendeesState } from "./actions";

export type TierOption = { id: string; name: string; seat_price_cents: number };

// Complimentary or paid-offline attendees for one tier. Records money already
// received (cash or check); it never takes card details.
export function AddAttendeesForm({ tiers }: { tiers: TierOption[] }) {
  const [state, setState] = useState<AddAttendeesState>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("complimentary");
  const [rows, setRows] = useState([0]);

  // Call the action by hand so a refused save keeps what the admin typed;
  // clear the form only after a save.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const result = await addAttendees(null, data);
      setState(result);
      if (!result?.ok) return;
      form.reset();
      setKind("complimentary");
      setRows([0]);
    });
  };

  return (
    <form onSubmit={onSubmit} className="gala-form" aria-labelledby="add-attendees-title">
      <h2 id="add-attendees-title">Add attendees</h2>
      <fieldset disabled={pending}>
        <fieldset className="gala-form__group">
          <legend>Kind</legend>
          <label>
            <input type="radio" name="kind" value="complimentary" checked={kind === "complimentary"} onChange={() => setKind("complimentary")} />{" "}
            Complimentary
          </label>
          <label>
            <input type="radio" name="kind" value="offline_paid" checked={kind === "offline_paid"} onChange={() => setKind("offline_paid")} />{" "}
            Paid offline (cash or check)
          </label>
        </fieldset>

        <div className="gala-form__grid">
          <label htmlFor="tier">Tier</label>
          <select id="tier" name="tier_id" required defaultValue="">
            <option value="" disabled>
              Choose a tier
            </option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · ${centsToDollars(t.seat_price_cents)} per seat
              </option>
            ))}
          </select>
          {kind === "offline_paid" && (
            <>
              <label htmlFor="amount">Amount received (USD)</label>
              <input id="amount" name="amount" required inputMode="decimal" aria-describedby="amount-hint" />
              <p id="amount-hint" className="gala-form__note">
                The total received for these attendees. It is split evenly across them.
              </p>
            </>
          )}
        </div>

        <table className="gala-form__tiers">
          <caption>Attendees</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Full name</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row}>
                <th scope="row">{i + 1}</th>
                <td>
                  <input aria-label={`Attendee ${i + 1} full name`} name="attendee_name" required={i === 0} autoComplete="off" />
                </td>
                <td>
                  <input aria-label={`Attendee ${i + 1} email`} name="attendee_email" type="email" required={i === 0} autoComplete="off" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="gala-form__secondary" onClick={() => setRows((r) => [...r, r.length])}>
          Add another attendee
        </button>

        <div>
          <button type="submit" className="gala-form__save">
            {pending ? "Saving…" : "Save attendees"}
          </button>
        </div>
      </fieldset>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "gala-form__ok" : "gala-form__error"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
