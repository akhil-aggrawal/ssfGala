"use client";

import { useState } from "react";
import { MAX_TICKETS, formatUsd, orderTotalCents, type TicketTier } from "@/lib/tickets/selection";
import { continueTickets } from "./actions";

const QUANTITIES = Array.from({ length: MAX_TICKETS }, (_, i) => i + 1);

// Tier cards, a quantity picker and a running total. Prices come from the
// server; the server action re-checks the choice on Continue.
export function TicketForm({
  tiers,
  initialTier,
  initialQuantity,
}: {
  tiers: TicketTier[];
  initialTier: string | null;
  initialQuantity: number;
}) {
  const [tierName, setTierName] = useState(initialTier);
  const [quantity, setQuantity] = useState(initialQuantity);
  const tier = tiers.find((t) => t.name === tierName) ?? null;

  return (
    <form action={continueTickets} className="ticket-form" aria-label="Choose tickets">
      <fieldset className="ticket-form__tiers">
        <legend>Seating tier</legend>
        {tiers.map((t) => (
          <label key={t.name} className="ticket-tier">
            <input
              type="radio"
              name="tier"
              value={t.name}
              required
              checked={tierName === t.name}
              onChange={() => setTierName(t.name)}
            />
            <span className="ticket-tier__name">{t.name}</span>
            <span className="ticket-tier__price">{formatUsd(t.seatPriceCents)} per seat</span>
          </label>
        ))}
      </fieldset>

      <label className="ticket-form__quantity">
        Quantity
        <select name="quantity" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
          {QUANTITIES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <p className="ticket-form__total" aria-live="polite">
        Total: <strong>{tier ? formatUsd(orderTotalCents(tier, quantity)) : "choose a tier"}</strong>
      </p>

      <button type="submit" className="ticket-form__continue">
        Continue
      </button>
    </form>
  );
}
