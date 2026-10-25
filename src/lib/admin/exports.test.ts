import { describe, expect, it } from "vitest";
import { parseExportFile, REPORT_KEYS, reportSheets, toCsv } from "./exports";
import type { Reports } from "./reports";

const reports: Reports = {
  tierAllocations: {
    rows: [{ tier: "Gold", inventory: 10, allocated: 2, available: 8 }],
    total: { inventory: 10, allocated: 2, available: 8 },
  },
  pledges: { rows: [{ sponsor: "Acme", tables: 2, pledgedCents: 400050 }], total: { tables: 2, pledgedCents: 400050 } },
  roster: [
    { name: "Ana Diaz", email: "ana@example.test", tier: "Gold", kind: "Sponsored", sponsor: "Acme", table: "7", paid: true },
    { name: "=HYPERLINK(\"x\")", email: "bo@example.test", tier: "Silver", kind: "Ticket", sponsor: null, table: null, paid: false },
  ],
  paidTickets: { rows: [], total: { seats: 0, amountCents: 0 } },
  contributions: { rows: [], total: { guests: 0, amountCents: 0 } },
  complimentary: { rows: [], total: 0 },
  offlineReceipts: {
    rows: [{ sponsor: "Acme", receivedAt: "2026-11-02T07:30:00Z", amountCents: 100000 }],
    total: 100000,
  },
  balances: {
    rows: [{ sponsor: "Acme", pledgedCents: 400050, receivedCents: 100000, outstandingCents: 300050 }],
    total: { pledgedCents: 400050, receivedCents: 100000, outstandingCents: 300050 },
  },
  overbooked: [],
};

const sheet = (key: string) => reportSheets(reports).find((s) => s.key === key)!;

describe("reportSheets", () => {
  it("has one sheet per report, in page order", () => {
    expect(reportSheets(reports).map((s) => s.key)).toEqual([...REPORT_KEYS]);
  });

  it("roster: one row per active attendee with name, email, tier, kind, table and paid status", () => {
    expect(sheet("roster").rows).toEqual([
      ["Name", "Email", "Tier", "Kind", "Sponsor", "Table", "Paid"],
      ["Ana Diaz", "ana@example.test", "Gold", "Sponsored", "Acme", "7", "Yes"],
      ['=HYPERLINK("x")', "bo@example.test", "Silver", "Ticket", null, null, "No"],
    ]);
  });

  it("money in dollars, dates as Pacific days, with a Total row", () => {
    expect(sheet("receipts").rows).toEqual([
      ["Sponsor", "Received", "Amount (USD)"],
      ["Acme", "2026-11-01", 1000],
      ["Total", null, 1000],
    ]);
    expect(sheet("balances").rows.at(-1)).toEqual(["Total", 4000.5, 1000, 3000.5]);
  });
});

describe("toCsv", () => {
  it("writes RFC 4180 CSV with a BOM, quoting and formula-safe text", () => {
    expect(toCsv(sheet("roster").rows)).toBe(
      "﻿Name,Email,Tier,Kind,Sponsor,Table,Paid\r\n" +
        "Ana Diaz,ana@example.test,Gold,Sponsored,Acme,7,Yes\r\n" +
        `"'=HYPERLINK(""x"")",bo@example.test,Silver,Ticket,,,No\r\n`,
    );
  });

  it("keeps negative numbers numeric", () => {
    expect(toCsv([["a, b", -5, "-5"]])).toBe(`﻿"a, b",-5,'-5\r\n`);
  });
});

describe("parseExportFile", () => {
  it("accepts <report>.csv and reports.xlsx only", () => {
    expect(parseExportFile("roster.csv")).toEqual({ report: "roster", format: "csv" });
    expect(parseExportFile("reports.xlsx")).toEqual({ report: "all", format: "xlsx" });
    expect(parseExportFile("roster.xlsx")).toBeNull();
    expect(parseExportFile("secrets.csv")).toBeNull();
    expect(parseExportFile("../roster.csv")).toBeNull();
  });
});
