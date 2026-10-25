"use client";

import { useActionState, type FormEvent } from "react";
import { PAID_GUEST_TEXT } from "@/lib/sponsor/guests";
import type { SponsorGuest } from "@/lib/sponsor/dashboard";
import { removeGuest, updateGuest } from "./actions";

// One guest on a sponsor's table: edit name and email, and remove an unpaid
// guest. A paid guest's Remove is disabled with the reason shown beside it;
// the server refuses it too.
export function GuestRow({ guest }: { guest: SponsorGuest }) {
  const [saved, saveAction, saving] = useActionState(updateGuest, null);
  const [removed, removeAction, removing] = useActionState(removeGuest, null);
  const busy = saving || removing;
  const nameId = `guest-name-${guest.id}`;
  const emailId = `guest-email-${guest.id}`;
  const paidId = `guest-paid-${guest.id}`;

  const confirmRemove = (e: FormEvent<HTMLFormElement>) => {
    if (!window.confirm(`Remove ${guest.full_name} from this table?`)) e.preventDefault();
  };

  return (
    <li className="guest-row">
      <p className="guest-row__who">
        {guest.full_name} <span className="sponsor-dash__email">{guest.email}</span>
      </p>
      <details className="guest-row__details">
        <summary>Edit guest</summary>
        <form action={saveAction} className="guest-row__edit">
          <input type="hidden" name="id" value={guest.id} />
          <label htmlFor={nameId}>Name</label>
          <input id={nameId} name="full_name" defaultValue={guest.full_name} required maxLength={200} disabled={busy} />
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            name="email"
            type="email"
            defaultValue={guest.email}
            required
            maxLength={320}
            disabled={busy}
          />
          <button type="submit" disabled={busy}>
            Save
          </button>
        </form>
      </details>
      <form action={removeAction} onSubmit={confirmRemove} className="guest-row__remove">
        <input type="hidden" name="id" value={guest.id} />
        <button
          type="submit"
          disabled={busy || guest.paid}
          aria-describedby={guest.paid ? paidId : undefined}
          aria-label={`Remove ${guest.full_name}`}
          title={guest.paid ? PAID_GUEST_TEXT : undefined}
        >
          Remove
        </button>
        {guest.paid && (
          <span id={paidId} className="guest-row__note">
            {PAID_GUEST_TEXT}
          </span>
        )}
      </form>
      <p role="status" className={(removed ?? saved)?.ok ? "guest-row__ok" : "guest-row__error"}>
        {removed?.message ?? saved?.message}
      </p>
    </li>
  );
}
