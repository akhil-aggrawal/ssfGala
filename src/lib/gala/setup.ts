// Gala setup: form parsing, defaults and error text for /admin/setup.
// Pure functions; the Server Action in app/admin/setup does the I/O.

export const TIER_NAMES = ["Silver", "Gold", "Platinum"] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const EVENT_STATUSES = ["draft", "open", "closed", "archived"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

// Dates are entered and shown in the gala's own time zone (ICC Milpitas).
export const GALA_TIME_ZONE = "America/Los_Angeles";

export type TierInput = {
  name: TierName;
  seat_price_cents: number;
  suggested_contribution_cents: number;
  sponsorship_amount_cents: number | null;
  table_inventory: number;
};

export type EventInput = {
  name: string;
  year: number;
  date_local: string;
  venue: string;
  status: EventStatus;
};

export type GalaInput = { event: EventInput; tiers: TierInput[] };

// Pre-filled on a new gala; a 10-seat table is suggested at ten seat prices.
export const DEFAULT_TIERS: readonly TierInput[] = [
  { name: "Silver", seat_price_cents: 15000, suggested_contribution_cents: 15000, sponsorship_amount_cents: 150000, table_inventory: 0 },
  { name: "Gold", seat_price_cents: 20000, suggested_contribution_cents: 20000, sponsorship_amount_cents: 200000, table_inventory: 0 },
  { name: "Platinum", seat_price_cents: 25000, suggested_contribution_cents: 25000, sponsorship_amount_cents: 250000, table_inventory: 0 },
];

// "1,500.05" → 150005. Integer maths only: money never goes through a float.
export function dollarsToCents(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim().replaceAll(",", ""));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDollars(cents: number | null): string {
  if (cents === null) return "";
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

export type ParseResult = { ok: true; value: GalaInput } | { ok: false; error: string };

const text = (fd: FormData, key: string) => (fd.get(key)?.toString() ?? "").trim();

export function parseGalaForm(fd: FormData): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });

  const name = text(fd, "name");
  if (!name) return fail("Event name is required.");
  const yearText = text(fd, "year");
  if (!/^\d{4}$/.test(yearText)) return fail("Year must be a four-digit year.");
  const dateLocal = text(fd, "date_local");
  if (dateLocal && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateLocal)) {
    return fail("Date must be a date and time.");
  }
  const status = text(fd, "status");
  if (!(EVENT_STATUSES as readonly string[]).includes(status)) {
    return fail("Status must be draft, open, closed or archived.");
  }

  const tiers: TierInput[] = [];
  for (const tier of TIER_NAMES) {
    const money = (field: string, label: string, optional = false): number | null | string => {
      const raw = text(fd, `${tier}.${field}`);
      if (optional && raw === "") return null;
      return dollarsToCents(raw) ?? `${tier} ${label} must be a dollar amount, like 200 or 200.50.`;
    };
    const seat = money("seat_price", "seat price");
    if (typeof seat !== "number") return fail(seat ?? "");
    const suggested = money("suggested_contribution", "suggested contribution");
    if (typeof suggested !== "number") return fail(suggested ?? "");
    const sponsorship = money("sponsorship_amount", "sponsorship amount", true);
    if (typeof sponsorship === "string") return fail(sponsorship);
    const inventory = text(fd, `${tier}.table_inventory`);
    if (!/^\d{1,6}$/.test(inventory)) {
      return fail(`${tier} table inventory must be a whole number of 0 or more.`);
    }
    tiers.push({
      name: tier,
      seat_price_cents: seat,
      suggested_contribution_cents: suggested,
      sponsorship_amount_cents: sponsorship,
      table_inventory: Number(inventory),
    });
  }

  return {
    ok: true,
    value: {
      event: { name, year: Number(yearText), date_local: dateLocal, venue: text(fd, "venue"), status: status as EventStatus },
      tiers,
    },
  };
}

// Plain-words text for a failed save_gala_setup call.
export function saveErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505" && error.message.includes("one_active_gala")) {
    return "There is already a draft or open gala. Close or archive it before starting another. Nothing was saved.";
  }
  if (error.code === "23505" && error.message.includes("events_year_key")) {
    return "That year already has a gala. Nothing was saved.";
  }
  if (error.code === "55000") return "This gala is archived and read-only. Nothing was saved.";
  if (error.code === "P0002") return "That gala no longer exists. Nothing was saved.";
  return "The gala could not be saved. Try again.";
}

// Stored timestamptz → the value a datetime-local input shows, in gala time.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GALA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
