import type { ReactNode } from "react";
import { formatCents } from "@/lib/admin/overview";
import type { Reports } from "@/lib/admin/reports";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" });
const n = (v: number) => v.toLocaleString("en-US");

type Cell = ReactNode;

// One report: a captioned table whose first column is the row header, with
// an optional Total row. `empty` shows instead of the table when no rows.
function Report({
  id,
  title,
  head,
  rows,
  total,
  empty,
}: {
  id: string;
  title: string;
  head: string[];
  rows: Cell[][];
  total?: Cell[];
  empty: string;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {rows.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <div className="admin-table-wrap" role="region" aria-labelledby={id} tabIndex={0}>
          <table className="admin-table">
            <caption>{title}</caption>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, i) => (
                <tr key={i}>
                  <th scope="row">{cells[0]}</th>
                  {cells.slice(1).map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {total && (
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {total.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

// FR-10 reports. Totals count active attendees and succeeded payments only.
export function ReportsView({ reports: r }: { reports: Reports }) {
  return (
    <>
      <Report
        id="report-tiers"
        title="Table allocations by tier"
        head={["Tier", "Inventory", "Allocated", "Available"]}
        rows={r.tierAllocations.rows.map((t) => [t.tier, n(t.inventory), n(t.allocated), n(t.available)])}
        total={[
          n(r.tierAllocations.total.inventory),
          n(r.tierAllocations.total.allocated),
          n(r.tierAllocations.total.available),
        ]}
        empty="No tiers are set up yet."
      />
      <Report
        id="report-pledges"
        title="Sponsor pledges"
        head={["Sponsor", "Tables", "Pledged"]}
        rows={r.pledges.rows.map((p) => [p.sponsor, n(p.tables), formatCents(p.pledgedCents)])}
        total={[n(r.pledges.total.tables), formatCents(r.pledges.total.pledgedCents)]}
        empty="No sponsorships pledged yet."
      />
      <Report
        id="report-roster"
        title="Roster"
        head={["Name", "Email", "Tier", "Type", "Sponsor", "Table", "Paid"]}
        rows={r.roster.map((a) => [
          a.name,
          a.email,
          a.tier,
          a.kind,
          a.sponsor ?? "—",
          a.table ?? "Unassigned",
          a.paid ? "Yes" : "No",
        ])}
        total={[n(r.roster.length), "", "", "", "", ""]}
        empty="No attendees yet."
      />
      <Report
        id="report-tickets"
        title="Paid tickets"
        head={["Tier", "Seats", "Amount"]}
        rows={r.paidTickets.rows.map((t) => [t.tier, n(t.seats), formatCents(t.amountCents)])}
        total={[n(r.paidTickets.total.seats), formatCents(r.paidTickets.total.amountCents)]}
        empty="No paid tickets yet."
      />
      <Report
        id="report-contributions"
        title="Guest contributions"
        head={["Sponsor", "Guests", "Amount"]}
        rows={r.contributions.rows.map((c) => [c.sponsor, n(c.guests), formatCents(c.amountCents)])}
        total={[n(r.contributions.total.guests), formatCents(r.contributions.total.amountCents)]}
        empty="No guest contributions yet."
      />
      <Report
        id="report-complimentary"
        title="Complimentary attendees"
        head={["Tier", "Attendees"]}
        rows={r.complimentary.rows.map((c) => [c.tier, n(c.count)])}
        total={[n(r.complimentary.total)]}
        empty="No complimentary attendees."
      />
      <Report
        id="report-receipts"
        title="Offline receipts"
        head={["Sponsor", "Received", "Amount"]}
        rows={r.offlineReceipts.rows.map((p) => [
          p.sponsor,
          p.receivedAt ? day.format(new Date(p.receivedAt)) : "—",
          formatCents(p.amountCents),
        ])}
        total={["", formatCents(r.offlineReceipts.total)]}
        empty="No offline receipts recorded yet."
      />
      <Report
        id="report-balances"
        title="Outstanding balances"
        head={["Sponsor", "Pledged", "Received", "Outstanding"]}
        rows={r.balances.rows.map((b) => [
          b.sponsor,
          formatCents(b.pledgedCents),
          formatCents(b.receivedCents),
          formatCents(b.outstandingCents),
        ])}
        total={[
          formatCents(r.balances.total.pledgedCents),
          formatCents(r.balances.total.receivedCents),
          formatCents(r.balances.total.outstandingCents),
        ]}
        empty="No sponsorships pledged yet."
      />
      <Report
        id="report-overbooked"
        title="Overbooked tables"
        head={["Table", "Sponsor", "Tier", "Guests", "Seats"]}
        rows={r.overbooked.map((t) => [t.table ?? "Unnumbered", t.sponsor, t.tier, n(t.seated), n(t.capacity)])}
        empty="No tables are overbooked."
      />
    </>
  );
}
