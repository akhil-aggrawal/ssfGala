import { formatCents } from "@/lib/admin/overview";
import type { Receipt, SponsorshipBalance } from "@/lib/admin/receipts";
import { ReceiptForm } from "./receipt-form";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" });

const recorderName = (r: Receipt) => r.recorder?.display_name || r.recorder?.email || "unknown";

// Pledged, received and outstanding per sponsorship, each receipt with who
// recorded it, and the offline record/correct forms. Payments here are
// recorded after the fact; there is deliberately no card or Stripe action.
export function Balances({ balances }: { balances: SponsorshipBalance[] }) {
  if (balances.length === 0) return <p>No sponsorships pledged yet.</p>;
  return (
    <>
      <div className="admin-table-wrap" role="region" aria-label="Sponsorship balances" tabIndex={0}>
        <table className="admin-table">
          <caption>Sponsorship balances</caption>
          <thead>
            <tr>
              <th scope="col">Sponsor</th>
              <th scope="col">Pledged</th>
              <th scope="col">Received</th>
              <th scope="col">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.id}>
                <th scope="row">
                  {b.sponsorName}
                  {b.status === "cancelled" && " (cancelled)"}
                </th>
                <td>{formatCents(b.pledgedCents)}</td>
                <td>{formatCents(b.receivedCents)}</td>
                <td>{formatCents(b.outstandingCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {balances.map((b) => (
        <section key={b.id} className="gala-form" aria-labelledby={`receipts-${b.id}`}>
          <h2 id={`receipts-${b.id}`}>{b.sponsorName}</h2>
          <p>
            {formatCents(b.receivedCents)} received of {formatCents(b.pledgedCents)} ·{" "}
            {formatCents(b.outstandingCents)} outstanding
          </p>
          {b.receipts.length > 0 && (
            <ul className="receipt-list">
              {b.receipts.map((r) => (
                <li key={r.id}>
                  <span className={r.status === "succeeded" ? undefined : "receipt-list__void"}>
                    {formatCents(r.amount_cents)} received{" "}
                    {r.received_at ? day.format(new Date(r.received_at)) : "—"} · recorded by {recorderName(r)}
                    {r.status === "refunded" && " · corrected"}
                  </span>
                  {r.status === "succeeded" && (
                    <details>
                      <summary>Correct this receipt</summary>
                      <ReceiptForm mode="correct" paymentId={r.id} label={`Correct ${formatCents(r.amount_cents)} receipt`} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ReceiptForm mode="record" sponsorshipId={b.id} label={`Record a receipt for ${b.sponsorName}`} />
        </section>
      ))}
    </>
  );
}
