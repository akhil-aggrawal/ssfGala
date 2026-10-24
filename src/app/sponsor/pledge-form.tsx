"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { formatUsd } from "@/lib/sponsor/format";
import { pledgeTables } from "./actions";

export type PledgeFormTier = { name: string; price: string; table_cents: number; tables_left: number };

// Tier and table counts, sponsor details, then a confirmation with one invite
// link per table. The total shown before confirming is a preview; the
// confirmed amount comes from the server.
export function PledgeForm({ tiers, email }: { tiers: PledgeFormTier[]; email: string }) {
  const [state, action, pending] = useActionState(pledgeTables, null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // React 19 resets a <form action> after submit; submit by hand so a refused
  // pledge keeps what the sponsor typed.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };

  if (state?.ok) {
    return (
      <section className="pledge__confirm" aria-labelledby="pledge-confirmed">
        <h2 id="pledge-confirmed">Thank you — your pledge is confirmed</h2>
        <p>
          Pledged amount: <strong>{formatUsd(state.pledged_cents)}</strong>
        </p>
        <p>Payment is collected offline. Our team will contact you about payment; nothing is charged online.</p>
        <h3>Your table invite links</h3>
        <p>Share each link with the guests for that table. Save these links now.</p>
        <ol className="pledge__links">
          {state.links.map((l, i) => (
            <li key={l.url}>
              <span>
                Table {i + 1} · {l.tier_name}
              </span>
              <input readOnly aria-label={`Table ${i + 1} invite link`} value={l.url} onFocus={(e) => e.currentTarget.select()} />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const total = tiers.reduce((sum, t) => sum + t.table_cents * (counts[t.name] ?? 0), 0);

  return (
    <form onSubmit={onSubmit} className="pledge__form" aria-labelledby="pledge-title">
      <h2 id="pledge-title">Choose your tables</h2>
      <fieldset disabled={pending}>
        <table className="pledge__tiers">
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">Per table</th>
              <th scope="col">Tables left</th>
              <th scope="col">Tables</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.name}>
                <th scope="row">{t.name}</th>
                <td>{t.price}</td>
                <td>{t.tables_left}</td>
                <td>
                  <input
                    aria-label={`${t.name} tables`}
                    name={`${t.name}.tables`}
                    type="number"
                    min={0}
                    max={t.tables_left}
                    inputMode="numeric"
                    defaultValue={0}
                    onChange={(e) => setCounts((c) => ({ ...c, [t.name]: Math.max(Number(e.target.value) || 0, 0) }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pledge__grid">
          <label htmlFor="pledge-name">Sponsor name</label>
          <input id="pledge-name" name="display_name" required autoComplete="name" />
          <label htmlFor="pledge-email">Email</label>
          <input id="pledge-email" name="email" type="email" required autoComplete="email" defaultValue={email} />
        </div>

        <p className="pledge__total">
          Total pledge: <strong>{formatUsd(total)}</strong> · payment collected offline
        </p>
        <button type="submit" className="pledge__submit">
          {pending ? "Confirming…" : "Confirm pledge"}
        </button>
      </fieldset>
      {state && !state.ok && (
        <p role="alert" className="pledge__error">
          {state.message}
        </p>
      )}
    </form>
  );
}
