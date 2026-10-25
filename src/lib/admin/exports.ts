import type { Reports } from "./reports";
import type { Cell, Sheet } from "@/lib/xlsx";

// FR-10 exports: each report from reports.ts as a sheet of plain cells for
// CSV and XLSX downloads at /admin/exports/<report>.csv and reports.xlsx.
// Money is in US dollars (cents / 100) so a spreadsheet can sum it.

export const REPORT_KEYS = [
  "tiers",
  "pledges",
  "roster",
  "tickets",
  "contributions",
  "complimentary",
  "receipts",
  "balances",
  "overbooked",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_TITLES: Record<ReportKey, string> = {
  tiers: "Table allocations by tier",
  pledges: "Sponsor pledges",
  roster: "Roster",
  tickets: "Paid tickets",
  contributions: "Guest contributions",
  complimentary: "Complimentary attendees",
  receipts: "Offline receipts",
  balances: "Outstanding balances",
  overbooked: "Overbooked tables",
};

export type ReportSheet = Sheet & { key: ReportKey };

export type ExportFile = { report: ReportKey; format: "csv" } | { report: "all"; format: "xlsx" };

// The file name in the URL → what to export; null for anything else.
export function parseExportFile(name: string): ExportFile | null {
  if (name === "reports.xlsx") return { report: "all", format: "xlsx" };
  const key = name.endsWith(".csv") ? name.slice(0, -4) : "";
  return (REPORT_KEYS as readonly string[]).includes(key) ? { report: key as ReportKey, format: "csv" } : null;
}

const usd = (cents: number) => cents / 100;
const day = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso)) : null;

export function reportSheets(r: Reports): ReportSheet[] {
  const sheets: { key: ReportKey; head: string[]; rows: Cell[][]; total?: Cell[] }[] = [
    {
      key: "tiers",
      head: ["Tier", "Inventory", "Allocated", "Available"],
      rows: r.tierAllocations.rows.map((t) => [t.tier, t.inventory, t.allocated, t.available]),
      total: [r.tierAllocations.total.inventory, r.tierAllocations.total.allocated, r.tierAllocations.total.available],
    },
    {
      key: "pledges",
      head: ["Sponsor", "Tables", "Pledged (USD)"],
      rows: r.pledges.rows.map((p) => [p.sponsor, p.tables, usd(p.pledgedCents)]),
      total: [r.pledges.total.tables, usd(r.pledges.total.pledgedCents)],
    },
    {
      // One row per active attendee: no total row.
      key: "roster",
      head: ["Name", "Email", "Tier", "Kind", "Sponsor", "Table", "Paid"],
      rows: r.roster.map((a) => [a.name, a.email, a.tier, a.kind, a.sponsor, a.table, a.paid ? "Yes" : "No"]),
    },
    {
      key: "tickets",
      head: ["Tier", "Seats", "Amount (USD)"],
      rows: r.paidTickets.rows.map((t) => [t.tier, t.seats, usd(t.amountCents)]),
      total: [r.paidTickets.total.seats, usd(r.paidTickets.total.amountCents)],
    },
    {
      key: "contributions",
      head: ["Sponsor", "Guests", "Amount (USD)"],
      rows: r.contributions.rows.map((c) => [c.sponsor, c.guests, usd(c.amountCents)]),
      total: [r.contributions.total.guests, usd(r.contributions.total.amountCents)],
    },
    {
      key: "complimentary",
      head: ["Tier", "Attendees"],
      rows: r.complimentary.rows.map((c) => [c.tier, c.count]),
      total: [r.complimentary.total],
    },
    {
      key: "receipts",
      head: ["Sponsor", "Received", "Amount (USD)"],
      rows: r.offlineReceipts.rows.map((p) => [p.sponsor, day(p.receivedAt), usd(p.amountCents)]),
      total: [null, usd(r.offlineReceipts.total)],
    },
    {
      key: "balances",
      head: ["Sponsor", "Pledged (USD)", "Received (USD)", "Outstanding (USD)"],
      rows: r.balances.rows.map((b) => [b.sponsor, usd(b.pledgedCents), usd(b.receivedCents), usd(b.outstandingCents)]),
      total: [usd(r.balances.total.pledgedCents), usd(r.balances.total.receivedCents), usd(r.balances.total.outstandingCents)],
    },
    {
      key: "overbooked",
      head: ["Table", "Sponsor", "Tier", "Guests", "Seats"],
      rows: r.overbooked.map((t) => [t.table, t.sponsor, t.tier, t.seated, t.capacity]),
    },
  ];
  return sheets.map(({ key, head, rows, total }) => ({
    key,
    name: REPORT_TITLES[key],
    rows: [head, ...rows, ...(total ? [["Total", ...total]] : [])],
  }));
}

// A cell a spreadsheet would run as a formula (= + - @, tab, CR) gets a
// leading apostrophe, so a guest name can never become a formula (CSV
// injection). Numbers stay numbers.
function csvField(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// RFC 4180 CSV with CRLF line ends and a UTF-8 BOM so Excel reads accents.
export function toCsv(rows: Cell[][]): string {
  return "﻿" + rows.map((cells) => cells.map(csvField).join(",") + "\r\n").join("");
}
