"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { AttendeeRow } from "@/lib/admin/attendees";
import { cancelAttendee, updateAttendee, type AttendeeActionState } from "./actions";

type Action = (prev: AttendeeActionState, fd: FormData) => Promise<AttendeeActionState>;

// Submit by hand: React 19 resets a <form action> after every submit, which
// would wipe a refused edit.
function useForm(action: Action) {
  const [state, run, pending] = useActionState(action, null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => run(data));
  };
  return { state, pending, onSubmit };
}

function Status({ state }: { state: AttendeeActionState }) {
  if (!state) return null;
  return (
    <p role="status" className={state.ok ? "attendee-form__ok" : "attendee-form__error"}>
      {state.message}
    </p>
  );
}

// Edit and cancel controls for one attendee row.
export function AttendeeActions({ attendee }: { attendee: AttendeeRow }) {
  const edit = useForm(updateAttendee);
  const cancel = useForm(cancelAttendee);
  const id = (field: string) => `attendee-${attendee.id}-${field}`;

  return (
    <div className="attendee-actions">
      <details>
        <summary>Edit</summary>
        <form onSubmit={edit.onSubmit} className="attendee-form" aria-label={`Edit ${attendee.fullName}`}>
          <fieldset disabled={edit.pending}>
            <input type="hidden" name="attendee_id" value={attendee.id} />
            <label htmlFor={id("name")}>Name</label>
            <input id={id("name")} name="full_name" required defaultValue={attendee.fullName} />
            <label htmlFor={id("email")}>Email</label>
            <input id={id("email")} name="email" type="email" required defaultValue={attendee.email} />
            <button type="submit">Save</button>
          </fieldset>
          <Status state={edit.state} />
        </form>
      </details>
      {!attendee.cancelled && (
        <details>
          <summary>Cancel</summary>
          <form onSubmit={cancel.onSubmit} className="attendee-form">
            <input type="hidden" name="attendee_id" value={attendee.id} />
            <p>Payments stay on record. This cannot be undone here.</p>
            <button type="submit" disabled={cancel.pending}>
              Cancel {attendee.fullName}
            </button>
            <Status state={cancel.state} />
          </form>
        </details>
      )}
    </div>
  );
}
