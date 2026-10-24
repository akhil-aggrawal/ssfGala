"use client";

import { useActionState } from "react";
import {
  EVENT_STATUSES,
  centsToDollars,
  type EventStatus,
  type TierInput,
} from "@/lib/gala/setup";
import { saveGala } from "./actions";

export type GalaFormEvent = {
  id: string | null;
  name: string;
  year: number | null;
  date_local: string;
  venue: string;
  status: EventStatus;
  tiers: TierInput[];
};

// One gala: event details, its three tiers, and status. Archived → read-only.
export function GalaForm({ event, title }: { event: GalaFormEvent; title: string }) {
  const [state, action, pending] = useActionState(saveGala, null);
  const readOnly = event.status === "archived";
  const key = event.id ?? "new";
  const id = (field: string) => `${key}-${field}`;

  return (
    <form action={action} className="gala-form" aria-labelledby={id("title")}>
      <h2 id={id("title")}>{title}</h2>
      {readOnly && <p className="gala-form__note">Archived galas are read-only.</p>}
      <fieldset disabled={readOnly || pending}>
        {event.id && <input type="hidden" name="event_id" value={event.id} />}
        <div className="gala-form__grid">
          <label htmlFor={id("name")}>Event name</label>
          <input id={id("name")} name="name" required defaultValue={event.name} />
          <label htmlFor={id("year")}>Year</label>
          <input id={id("year")} name="year" required inputMode="numeric" pattern="\d{4}" defaultValue={event.year ?? ""} />
          <label htmlFor={id("date")}>Date and time (Pacific)</label>
          <input id={id("date")} name="date_local" type="datetime-local" defaultValue={event.date_local} />
          <label htmlFor={id("venue")}>Venue</label>
          <input id={id("venue")} name="venue" defaultValue={event.venue} />
          <label htmlFor={id("status")}>Status</label>
          <select id={id("status")} name="status" defaultValue={event.status}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <table className="gala-form__tiers">
          <caption>Tiers (USD)</caption>
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">Seat price</th>
              <th scope="col">Suggested contribution</th>
              <th scope="col">Sponsorship amount</th>
              <th scope="col">Table inventory</th>
            </tr>
          </thead>
          <tbody>
            {event.tiers.map((t) => (
              <tr key={t.name}>
                <th scope="row">{t.name}</th>
                <td>
                  <input aria-label={`${t.name} seat price`} name={`${t.name}.seat_price`} required inputMode="decimal" defaultValue={centsToDollars(t.seat_price_cents)} />
                </td>
                <td>
                  <input aria-label={`${t.name} suggested contribution`} name={`${t.name}.suggested_contribution`} required inputMode="decimal" defaultValue={centsToDollars(t.suggested_contribution_cents)} />
                </td>
                <td>
                  <input aria-label={`${t.name} sponsorship amount`} name={`${t.name}.sponsorship_amount`} inputMode="decimal" defaultValue={centsToDollars(t.sponsorship_amount_cents)} />
                </td>
                <td>
                  <input aria-label={`${t.name} table inventory`} name={`${t.name}.table_inventory`} required inputMode="numeric" defaultValue={t.table_inventory} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!readOnly && (
          <button type="submit" className="gala-form__save">
            {pending ? "Saving…" : "Save"}
          </button>
        )}
      </fieldset>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "gala-form__ok" : "gala-form__error"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
