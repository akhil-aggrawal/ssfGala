import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIERS,
  centsToDollars,
  dollarsToCents,
  parseGalaForm,
  saveErrorMessage,
  toLocalInput,
} from "./setup";

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Gala 2027",
    year: "2027",
    date_local: "2027-01-23T18:00",
    venue: "ICC Milpitas",
    status: "draft",
  };
  for (const tier of DEFAULT_TIERS) {
    base[`${tier.name}.seat_price`] = centsToDollars(tier.seat_price_cents);
    base[`${tier.name}.suggested_contribution`] = centsToDollars(tier.suggested_contribution_cents);
    base[`${tier.name}.sponsorship_amount`] = centsToDollars(tier.sponsorship_amount_cents);
    base[`${tier.name}.table_inventory`] = String(tier.table_inventory);
  }
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

describe("DEFAULT_TIERS", () => {
  it("defaults Silver, Gold and Platinum to $150, $200 and $250 per seat", () => {
    expect(DEFAULT_TIERS.map((t) => [t.name, t.seat_price_cents])).toEqual([
      ["Silver", 15000],
      ["Gold", 20000],
      ["Platinum", 25000],
    ]);
  });
});

describe("dollarsToCents", () => {
  it.each([
    ["150", 15000],
    ["150.5", 15050],
    ["1,500.05", 150005],
    [" 0 ", 0],
  ])("%s → %d", (input, cents) => expect(dollarsToCents(input)).toBe(cents));

  it.each(["", "-1", "1.234", "abc", "1e3"])("rejects %j", (input) =>
    expect(dollarsToCents(input)).toBeNull(),
  );
});

describe("parseGalaForm", () => {
  it("turns a valid form into an event and exactly three tiers in cents", () => {
    const result = parseGalaForm(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event).toEqual({
      name: "Gala 2027",
      year: 2027,
      date_local: "2027-01-23T18:00",
      venue: "ICC Milpitas",
      status: "draft",
    });
    expect(result.value.tiers).toHaveLength(3);
    expect(result.value.tiers[0]).toEqual({
      name: "Silver",
      seat_price_cents: 15000,
      suggested_contribution_cents: 15000,
      sponsorship_amount_cents: 150000,
      table_inventory: 0,
    });
  });

  it("accepts every status, including archived", () => {
    for (const status of ["draft", "open", "closed", "archived"]) {
      expect(parseGalaForm(form({ status })).ok).toBe(true);
    }
  });

  it("leaves a blank sponsorship amount as null", () => {
    const result = parseGalaForm(form({ "Gold.sponsorship_amount": "" }));
    expect(result.ok && result.value.tiers[1].sponsorship_amount_cents).toBeNull();
  });

  it.each([
    [{ name: " " }, "Event name is required."],
    [{ year: "27" }, "Year must be a four-digit year."],
    [{ status: "live" }, "Status must be draft, open, closed or archived."],
    [{ "Gold.seat_price": "-5" }, "Gold seat price must be a dollar amount, like 200 or 200.50."],
    [{ "Silver.table_inventory": "1.5" }, "Silver table inventory must be a whole number of 0 or more."],
  ])("rejects %j", (overrides, message) => {
    expect(parseGalaForm(form(overrides))).toEqual({ ok: false, error: message });
  });
});

describe("saveErrorMessage", () => {
  it("explains a second active event", () => {
    expect(saveErrorMessage({ code: "23505", message: 'violates "one_active_gala"' })).toMatch(
      /already a draft or open gala/,
    );
  });
  it("explains a duplicate year", () => {
    expect(saveErrorMessage({ code: "23505", message: 'violates "events_year_key"' })).toMatch(
      /already has a gala/,
    );
  });
  it("explains an archived event", () => {
    expect(saveErrorMessage({ code: "55000", message: "gala_setup_archived" })).toMatch(
      /read-only/,
    );
  });
  it("falls back to a generic message", () => {
    expect(saveErrorMessage({ code: "XX000", message: "boom" })).toBe(
      "The gala could not be saved. Try again.",
    );
  });
});

describe("toLocalInput", () => {
  it("shows a stored time in gala-local (Pacific) time", () => {
    expect(toLocalInput("2027-01-24T02:00:00+00:00")).toBe("2027-01-23T18:00");
  });
  it("returns empty for no date", () => expect(toLocalInput(null)).toBe(""));
});
