import { describe, expect, it } from "vitest";
import { parseReceiptForm, receiptErrorMessage, summarizeSponsorships } from "./receipts";

const receipt = (amount_cents: number, status = "succeeded", sponsorship_id = "s1") => ({
  id: `p${amount_cents}`,
  sponsorship_id,
  amount_cents,
  status,
  received_at: "2027-01-05T08:00:00+00:00",
  created_at: "2027-01-05T09:00:00+00:00",
  recorder: null,
});

describe("summarizeSponsorships", () => {
  const pledge = { id: "s1", pledged_cents: 200000, status: "committed", sponsor: { display_name: "Acme" } };

  it("shows $800 received and $1,200 outstanding after $500 and $300 on a $2,000 pledge", () => {
    const [row] = summarizeSponsorships([pledge], [receipt(50000), receipt(30000)]);
    expect(row).toMatchObject({ receivedCents: 80000, outstandingCents: 120000, sponsorName: "Acme" });
    expect(row.receipts).toHaveLength(2);
  });

  it("counts only succeeded receipts; a corrected one stays listed but not counted", () => {
    const [row] = summarizeSponsorships([pledge], [receipt(50000, "refunded"), receipt(45000)]);
    expect(row.receivedCents).toBe(45000);
    expect(row.receipts).toHaveLength(2);
  });

  it("floors outstanding at zero and keeps receipts on their own pledge", () => {
    const other = { ...pledge, id: "s2", pledged_cents: 10000 };
    const rows = summarizeSponsorships([pledge, other], [receipt(20000, "succeeded", "s2")]);
    expect(rows.map((r) => [r.receivedCents, r.outstandingCents])).toEqual([
      [0, 200000],
      [20000, 0],
    ]);
  });
});

describe("parseReceiptForm", () => {
  const form = (amount: string, date: string) => {
    const fd = new FormData();
    fd.set("amount", amount);
    fd.set("received_on", date);
    return fd;
  };

  it("reads dollars as integer cents and keeps the date", () => {
    expect(parseReceiptForm(form("1,200.50", "2027-01-05"))).toEqual({
      ok: true,
      value: { amount_cents: 120050, received_on: "2027-01-05" },
    });
  });

  it("refuses $0 for a new receipt but allows it for a correction (void)", () => {
    expect(parseReceiptForm(form("0", "2027-01-05")).ok).toBe(false);
    expect(parseReceiptForm(form("0", "2027-01-05"), { allowZero: true }).ok).toBe(true);
  });

  it("refuses a bad amount or date", () => {
    expect(parseReceiptForm(form("abc", "2027-01-05")).ok).toBe(false);
    expect(parseReceiptForm(form("10", "")).ok).toBe(false);
    expect(parseReceiptForm(form("10", "2027-02-30")).ok).toBe(false);
  });
});

describe("receiptErrorMessage", () => {
  it("names a corrected receipt and an archived gala", () => {
    expect(receiptErrorMessage({ code: "55000", message: "receipt_archived" })).toMatch(/archived/i);
    expect(receiptErrorMessage({ code: "55000", message: "receipt_not_correctable" })).toMatch(/already corrected/i);
    expect(receiptErrorMessage({ code: "P0002", message: "x" })).toMatch(/not found/i);
  });
});
